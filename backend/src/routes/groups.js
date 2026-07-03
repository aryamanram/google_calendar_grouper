const express = require("express");
const router = express.Router();
const db = require("../models/firestore");
const googleApi = require("../services/googleApi");
const { syncGroup, purgeSourceCalendar } = require("../services/calendarSync");
const { registerWatchesForGroup, stopWatchesForGroup, stopWatchForCalendar } = require("../services/watchManager");

// ---------------------------------------------------------------------------
// POST /groups
//
// Create a new calendar group. This:
// 1. Creates a merged Google Calendar on the user's account
// 2. Stores the group config in Firestore
// 3. Registers webhook watches on each source calendar
// 4. Runs an initial sync
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  const { userId, name, sourceCalendars } = req.body;

  if (!userId || !name || !sourceCalendars?.length) {
    return res.status(400).json({
      error: "Required: userId, name, sourceCalendars (array of {id, summary, detailLevel})",
    });
  }

  try {
    // 1. Create the merged calendar on Google
    const merged = await googleApi.createCalendar(userId, name);

    // 2. Store in Firestore
    const group = await db.createGroup(userId, {
      name,
      mergedCalendarId: merged.id,
      sourceCalendars: sourceCalendars.map((c) => ({
        id: c.id,
        summary: c.summary,
        detailLevel: c.detailLevel || "full",
        syncToken: null,
      })),
    });

    // 3. Register watches for live sync
    const watches = await registerWatchesForGroup(userId, group.id);

    // 4. Initial sync
    const syncResults = await syncGroup(userId, group.id);

    res.status(201).json({
      group: { ...group, mergedCalendarId: merged.id },
      watches,
      initialSync: syncResults,
    });
  } catch (err) {
    console.error("Failed to create group:", err);
    res.status(500).json({ error: err.message });
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
    console.error("Failed to list groups:", err);
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
    console.error("Failed to get group:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /groups/:groupId
//
// Update group config — handles adding/removing source calendars and
// changing detail levels.
// ---------------------------------------------------------------------------
router.patch("/:groupId", async (req, res) => {
  const { userId, name, sourceCalendars } = req.body;
  const { groupId } = req.params;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const existing = await db.getGroup(userId, groupId);
    if (!existing) return res.status(404).json({ error: "Group not found" });

    const updates = {};
    if (name) updates.name = name;

    if (sourceCalendars) {
      const oldIds = new Set(existing.sourceCalendars.map((c) => c.id));
      const newIds = new Set(sourceCalendars.map((c) => c.id));

      // Calendars that were removed — purge their events and stop watches
      for (const old of existing.sourceCalendars) {
        if (!newIds.has(old.id)) {
          await purgeSourceCalendar(userId, groupId, old.id, existing.mergedCalendarId);
          await stopWatchForCalendar(userId, groupId, old.id);
        }
      }

      // Preserve sync tokens for calendars that are still included
      updates.sourceCalendars = sourceCalendars.map((c) => {
        const prev = existing.sourceCalendars.find((p) => p.id === c.id);
        return {
          id: c.id,
          summary: c.summary,
          detailLevel: c.detailLevel || "full",
          syncToken: prev?.syncToken || null,
        };
      });

      await db.updateGroup(userId, groupId, updates);

      // Register watches for newly added calendars
      const addedCalendars = sourceCalendars.filter((c) => !oldIds.has(c.id));
      if (addedCalendars.length > 0) {
        // Re-register all watches (simpler than tracking individual ones)
        await registerWatchesForGroup(userId, groupId);
      }

      // Sync newly added calendars
      for (const cal of addedCalendars) {
        const { syncSourceCalendar } = require("../services/calendarSync");
        await syncSourceCalendar(
          userId, groupId, cal.id, existing.mergedCalendarId, cal.detailLevel || "full"
        );
      }
    } else {
      await db.updateGroup(userId, groupId, updates);
    }

    const updated = await db.getGroup(userId, groupId);
    res.json({ group: updated });
  } catch (err) {
    console.error("Failed to update group:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /groups/:groupId?userId=...
// ---------------------------------------------------------------------------
router.delete("/:groupId", async (req, res) => {
  const { userId } = req.query;
  const { groupId } = req.params;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const group = await db.getGroup(userId, groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    // Stop all watches
    await stopWatchesForGroup(userId, groupId);

    // Delete the merged calendar from Google
    if (group.mergedCalendarId) {
      await googleApi.deleteCalendar(userId, group.mergedCalendarId);
    }

    // Delete from Firestore (group + event mappings)
    await db.deleteGroup(userId, groupId);

    res.json({ deleted: true });
  } catch (err) {
    console.error("Failed to delete group:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /groups/:groupId/sync?userId=...
//
// Manual "force sync" trigger — useful for debugging or if the user wants
// an immediate refresh.
// ---------------------------------------------------------------------------
router.post("/:groupId/sync", async (req, res) => {
  const { userId } = req.body;
  const { groupId } = req.params;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const results = await syncGroup(userId, groupId);
    res.json({ results });
  } catch (err) {
    console.error("Manual sync failed:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
