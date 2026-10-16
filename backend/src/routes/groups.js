const express = require("express");
const router = express.Router();
const db = require("../models/firestore");
const googleApi = require("../services/googleApi");
const {
  syncGroup,
  syncSourceCalendar,
  purgeSourceCalendar,
  cancelGroup,
} = require("../services/calendarSync");
const {
  registerWatchesForGroup,
  stopWatchesForGroup,
  stopWatchForCalendar,
} = require("../services/watchManager");

// ---------------------------------------------------------------------------
// Guards against double-clicks and overlapping work
//
// creatingUsers: a user with a Create request in flight. A second Create
//   while the first is running gets 409 instead of making another calendar.
// busyGroups: a group whose events are being copied right now. Updates and
//   manual syncs wait until it finishes.
//
// These live in memory, which is correct for a single server process. If
// this ever runs as several Cloud Run instances, move the lock into a
// Firestore transaction.
// ---------------------------------------------------------------------------
const creatingUsers = new Set();
const busyGroups = new Set();

// MVP: one shared calendar per user. Raise this when multiple groups land.
const MAX_GROUPS_PER_USER = 1;

function isGone(err) {
  const code = err.code || err.response?.status;
  return code === 404 || code === 410;
}

async function deleteCalendarIfExists(userId, calendarId) {
  if (!calendarId) return;
  try {
    await googleApi.deleteCalendar(userId, calendarId);
  } catch (err) {
    if (!isGone(err)) throw err;
  }
}

function cleanSources(list) {
  return list.map((c) => ({
    id: c.id,
    summary: c.summary,
    detailLevel: c.detailLevel === "busy" ? "busy" : "full",
  }));
}

/**
 * Run slow calendar work in the background and record its progress on the
 * group document so the popup can show "Copying events…" and then the result.
 * Starts synchronously (busyGroups is set before the first await), so callers
 * can fire it and respond to the HTTP request straight away.
 */
function runGroupJob(userId, groupId, label, job) {
  busyGroups.add(groupId);
  (async () => {
    try {
      await db.updateGroup(userId, groupId, { status: "syncing", lastError: null });
      await job();
      await db.updateGroup(userId, groupId, { status: "ready", lastError: null });
      console.log(`${label} finished for group ${groupId}`);
    } catch (err) {
      console.error(`${label} failed for group ${groupId}: ${err.message}`);
      // The group may have been deleted mid-job; ignore that failure.
      await db
        .updateGroup(userId, groupId, { status: "error", lastError: err.message })
        .catch(() => {});
    } finally {
      busyGroups.delete(groupId);
    }
  })();
}

// ---------------------------------------------------------------------------
// POST /groups
//
// Create the shared calendar. Responds as soon as the Google calendar exists
// and the config is saved (about a second). Watch registration and the first
// event copy then run in the background; poll GET /groups/:id for `status`.
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  const { userId, name, sourceCalendars } = req.body;

  if (!userId || !name?.trim() || !sourceCalendars?.length) {
    return res.status(400).json({
      error: "Required: userId, name, sourceCalendars (array of {id, summary, detailLevel})",
    });
  }

  if (creatingUsers.has(userId)) {
    return res.status(409).json({
      error: "Your shared calendar is already being created.",
      code: "CREATE_IN_PROGRESS",
    });
  }

  creatingUsers.add(userId);
  let mergedCalendarId = null;
  let groupSaved = false;

  try {
    const existing = await db.listGroups(userId);
    if (existing.length >= MAX_GROUPS_PER_USER) {
      return res.status(409).json({
        error: "You already have a shared calendar. Update or delete it instead.",
        code: "GROUP_EXISTS",
        group: existing[0],
      });
    }

    const merged = await googleApi.createCalendar(userId, name.trim());
    mergedCalendarId = merged.id;

    const group = await db.createGroup(userId, {
      name: name.trim(),
      mergedCalendarId,
      status: "syncing",
      sourceCalendars: cleanSources(sourceCalendars).map((c) => ({ ...c, syncToken: null })),
    });
    groupSaved = true;

    res.status(201).json({ group });

    runGroupJob(userId, group.id, "Initial sync", async () => {
      await registerWatchesForGroup(userId, group.id);
      await syncGroup(userId, group.id);
    });
  } catch (err) {
    console.error("Failed to create group:", err.message);
    // Don't leave an orphaned calendar behind if saving the config failed.
    if (mergedCalendarId && !groupSaved) {
      await deleteCalendarIfExists(userId, mergedCalendarId).catch(() => {});
    }
    if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally {
    creatingUsers.delete(userId);
  }
});

// ---------------------------------------------------------------------------
// GET /groups?userId=...
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const groups = await db.listGroups(userId);
    res.json({ groups });
  } catch (err) {
    console.error("Failed to list groups:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /groups/cleanup
//
// Removes every shared calendar for a user, including orphans that Firestore
// lost track of. Defaults to a dry run that only lists what it would delete.
// Body: { userId, orphanName?: "My full schedule", dryRun?: true }
//
// `orphanName` also matches untagged calendars with that exact title (needed
// for calendars created before the managed tag existed). Only calendars you
// own are ever touched, and never your primary calendar.
// ---------------------------------------------------------------------------
router.post("/cleanup", async (req, res) => {
  const { userId, orphanName, dryRun = true } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const [groups, calendars] = await Promise.all([
      db.listGroups(userId),
      googleApi.listCalendars(userId),
    ]);

    const groupCalendarIds = new Set(groups.map((g) => g.mergedCalendarId).filter(Boolean));
    const orphans = calendars.filter(
      (c) =>
        c.accessRole === "owner" &&
        !c.primary &&
        !groupCalendarIds.has(c.id) &&
        (googleApi.isManagedCalendar(c) || (orphanName && c.summary === orphanName))
    );

    const plan = {
      groups: groups.map((g) => ({ id: g.id, name: g.name, mergedCalendarId: g.mergedCalendarId })),
      orphanCalendars: orphans.map((c) => ({ id: c.id, summary: c.summary })),
    };

    if (dryRun) {
      return res.json({
        dryRun: true,
        ...plan,
        note: 'Nothing was deleted. Re-run with "dryRun": false to delete everything listed.',
      });
    }

    for (const g of groups) {
      cancelGroup(g.id);
      await stopWatchesForGroup(userId, g.id);
      await deleteCalendarIfExists(userId, g.mergedCalendarId);
      await db.deleteGroup(userId, g.id);
      console.log(`Cleanup: deleted group ${g.id} and its calendar`);
    }
    for (const c of orphans) {
      await deleteCalendarIfExists(userId, c.id);
      console.log(`Cleanup: deleted orphan calendar ${c.id}`);
    }

    res.json({ dryRun: false, deleted: plan });
  } catch (err) {
    console.error("Cleanup failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /groups/:groupId?userId=...
// ---------------------------------------------------------------------------
router.get("/:groupId", async (req, res) => {
  const { userId } = req.query;
  const { groupId } = req.params;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const group = await db.getGroup(userId, groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });
    res.json({ group });
  } catch (err) {
    console.error("Failed to get group:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /groups/:groupId
//
// Change the name, the included calendars, or a calendar's detail level.
// The config is saved immediately; event changes run in the background:
//   removed calendars → their events are deleted from the shared calendar
//   detail level changed → that calendar's events are rebuilt
//   added calendars → watched and copied in
// ---------------------------------------------------------------------------
router.patch("/:groupId", async (req, res) => {
  const { userId, name, sourceCalendars } = req.body;
  const { groupId } = req.params;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  if (busyGroups.has(groupId)) {
    return res.status(409).json({
      error: "Still copying events from the last change. Try again when it finishes.",
      code: "SYNC_IN_PROGRESS",
    });
  }

  try {
    const existing = await db.getGroup(userId, groupId);
    if (!existing) return res.status(404).json({ error: "Group not found" });

    const updates = {};

    const newName = name?.trim();
    if (newName && newName !== existing.name) {
      await googleApi.renameCalendar(userId, existing.mergedCalendarId, newName);
      updates.name = newName;
    }

    let removed = [];
    let added = [];
    let changed = [];

    if (sourceCalendars) {
      if (sourceCalendars.length === 0) {
        return res.status(400).json({ error: "Select at least one calendar" });
      }
      const next = cleanSources(sourceCalendars);
      const prevById = new Map(existing.sourceCalendars.map((c) => [c.id, c]));
      const nextIds = new Set(next.map((c) => c.id));

      removed = existing.sourceCalendars.filter((c) => !nextIds.has(c.id));
      added = next.filter((c) => !prevById.has(c.id));
      changed = next.filter(
        (c) => prevById.has(c.id) && (prevById.get(c.id).detailLevel || "full") !== c.detailLevel
      );
      const changedIds = new Set(changed.map((c) => c.id));

      updates.sourceCalendars = next.map((c) => ({
        ...c,
        // A detail-level change rebuilds that calendar, so drop its sync token.
        syncToken: changedIds.has(c.id) ? null : prevById.get(c.id)?.syncToken || null,
      }));
    }

    const needsJob = removed.length + added.length + changed.length > 0;
    if (needsJob) updates.status = "syncing";
    if (Object.keys(updates).length) await db.updateGroup(userId, groupId, updates);

    res.json({ group: await db.getGroup(userId, groupId) });

    if (needsJob) {
      const mergedId = existing.mergedCalendarId;
      runGroupJob(userId, groupId, "Update", async () => {
        for (const c of removed) {
          await stopWatchForCalendar(userId, groupId, c.id);
          await purgeSourceCalendar(userId, groupId, c.id, mergedId);
        }
        for (const c of changed) {
          await purgeSourceCalendar(userId, groupId, c.id, mergedId);
          await syncSourceCalendar(userId, groupId, c.id, mergedId, c.detailLevel);
        }
        if (added.length) {
          await registerWatchesForGroup(userId, groupId, added.map((c) => c.id));
        }
        for (const c of added) {
          await syncSourceCalendar(userId, groupId, c.id, mergedId, c.detailLevel);
        }
      });
    }
  } catch (err) {
    console.error("Failed to update group:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /groups/:groupId?userId=...
//
// Stops any running sync, deletes the shared Google calendar (which also
// removes it for everyone it was shared with), and removes the config.
// ---------------------------------------------------------------------------
router.delete("/:groupId", async (req, res) => {
  const { userId } = req.query;
  const { groupId } = req.params;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const group = await db.getGroup(userId, groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    cancelGroup(groupId);
    await stopWatchesForGroup(userId, groupId);
    await deleteCalendarIfExists(userId, group.mergedCalendarId);
    await db.deleteGroup(userId, groupId);

    console.log(`Deleted group ${groupId} ("${group.name}")`);
    res.json({ deleted: true });
  } catch (err) {
    console.error("Failed to delete group:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /groups/:groupId/sync
//
// Manual "sync now". Waits for the sync and returns per-calendar counts,
// which makes it handy for testing from curl while webhooks are off.
// ---------------------------------------------------------------------------
router.post("/:groupId/sync", async (req, res) => {
  const { userId } = req.body;
  const { groupId } = req.params;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  if (busyGroups.has(groupId)) {
    return res.status(409).json({
      error: "A sync is already running for this calendar.",
      code: "SYNC_IN_PROGRESS",
    });
  }

  busyGroups.add(groupId);
  try {
    const results = await syncGroup(userId, groupId);
    await db.updateGroup(userId, groupId, { status: "ready", lastError: null });
    res.json({ results });
  } catch (err) {
    console.error("Manual sync failed:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    busyGroups.delete(groupId);
  }
});

module.exports = router;
