const googleApi = require("./googleApi");
const db = require("../models/firestore");

// ---------------------------------------------------------------------------
// Cancellation
//
// When a group is deleted mid-sync, the copy loop checks this set and stops
// instead of writing events into a calendar that no longer exists.
// ---------------------------------------------------------------------------
const cancelledGroups = new Set();

function cancelGroup(groupId) {
  cancelledGroups.add(groupId);
  // Group IDs are never reused; forget the entry after a while.
  setTimeout(() => cancelledGroups.delete(groupId), 10 * 60 * 1000).unref();
}

/** Undo cancelGroup (used when a delete turns out not to be possible). */
function uncancelGroup(groupId) {
  cancelledGroups.delete(groupId);
}

function assertNotCancelled(groupId) {
  if (cancelledGroups.has(groupId)) {
    throw new Error("Shared calendar was deleted; stopping sync");
  }
}

// ---------------------------------------------------------------------------
// Event body builder
//
// Converts a source event into the body we insert/update on the merged
// calendar. Respects the detailLevel setting per source calendar.
// ---------------------------------------------------------------------------

function buildMergedEventBody(sourceEvent, detailLevel) {
  // Base: always copy timing
  const body = {
    start: sourceEvent.start,
    end: sourceEvent.end,
    status: sourceEvent.status,
  };

  if (sourceEvent.recurrence) {
    body.recurrence = sourceEvent.recurrence;
  }

  if (detailLevel === "full") {
    // Copy all meaningful fields
    body.summary = sourceEvent.summary;
    body.description = sourceEvent.description;
    body.location = sourceEvent.location;
    body.colorId = sourceEvent.colorId;
    body.transparency = sourceEvent.transparency;
    body.visibility = sourceEvent.visibility;
    // We intentionally skip: attendees, reminders, conferenceData, attachments
    // These don't make sense on a mirrored read-only calendar.
  } else {
    // "busy" mode — strip everything, just block the time
    body.summary = "Busy";
    body.transparency = "opaque";
  }

  return body;
}

function isGone(err) {
  const code = err.code || err.response?.status;
  return code === 404 || code === 410;
}

// ---------------------------------------------------------------------------
// Single occurrences of a recurring series
//
// When you edit or delete one occurrence of a repeating event, Google reports
// it as its own event with `recurringEventId` (the series) and
// `originalStartTime` (which occurrence). We find the matching occurrence of
// our copied series on the shared calendar and change just that one.
// ---------------------------------------------------------------------------

async function findMergedOccurrence(userId, groupId, sourceCalendarId, mergedCalendarId, event) {
  const series = await db.getEventMapping(userId, groupId, sourceCalendarId, event.recurringEventId);
  const originalStart = event.originalStartTime?.dateTime || event.originalStartTime?.date;
  if (!series || !originalStart) return null;
  return googleApi.findInstance(userId, mergedCalendarId, series.mergedEventId, originalStart);
}

/** Returns "inserted" | "updated" | "deleted" | "skipped". */
async function applyOccurrenceChange(userId, groupId, sourceCalendarId, mergedCalendarId, event, detailLevel) {
  const existing = await db.getEventMapping(userId, groupId, sourceCalendarId, event.id);

  if (event.status === "cancelled") {
    // One occurrence was deleted: cancel the same occurrence on our copy.
    let targetId = existing?.mergedEventId;
    if (!targetId) {
      targetId = (await findMergedOccurrence(userId, groupId, sourceCalendarId, mergedCalendarId, event))?.id;
    }
    if (!targetId) return "skipped";
    try {
      await googleApi.deleteEvent(userId, mergedCalendarId, targetId);
    } catch (e) {
      if (!isGone(e)) throw e;
    }
    if (existing) await db.deleteEventMapping(userId, groupId, sourceCalendarId, event.id);
    return "deleted";
  }

  if (existing && existing.sourceUpdated && existing.sourceUpdated === event.updated) return "skipped";

  const body = buildMergedEventBody(event, detailLevel);
  let targetId = existing?.mergedEventId;
  if (!targetId) {
    targetId = (await findMergedOccurrence(userId, groupId, sourceCalendarId, mergedCalendarId, event))?.id;
  }

  if (targetId) {
    try {
      await googleApi.updateEvent(userId, mergedCalendarId, targetId, body);
      await db.saveEventMapping(userId, groupId, sourceCalendarId, event.id, targetId, {
        sourceUpdated: event.updated || null,
      });
      return "updated";
    } catch (e) {
      if (!isGone(e)) throw e;
    }
  }

  // The series itself isn't on the shared calendar (for example it ended
  // before the sync window), so copy this occurrence as a standalone event.
  const created = await googleApi.insertEvent(userId, mergedCalendarId, body);
  await db.saveEventMapping(userId, groupId, sourceCalendarId, event.id, created.id, {
    sourceUpdated: event.updated || null,
  });
  return "inserted";
}

// ---------------------------------------------------------------------------
// Sync a single source calendar into the merged calendar
// ---------------------------------------------------------------------------

/**
 * Applies everything that changed on one source calendar since the last
 * sync (or everything, on the first sync) to the merged calendar.
 *
 * @param {string} userId
 * @param {string} groupId
 * @param {string} sourceCalendarId
 * @param {string} mergedCalendarId
 * @param {string} detailLevel  "full" | "busy"
 */
async function syncSourceCalendar(userId, groupId, sourceCalendarId, mergedCalendarId, detailLevel) {
  assertNotCancelled(groupId);
  const group = await db.getGroup(userId, groupId);
  if (!group) throw new Error(`Group ${groupId} no longer exists`);
  const calConfig = (group.sourceCalendars || []).find((c) => c.id === sourceCalendarId);
  const label = calConfig?.summary || sourceCalendarId;
  const syncToken = calConfig?.syncToken || null;

  let result;
  let tokenReset = false;
  try {
    result = await googleApi.listEvents(userId, sourceCalendarId, { syncToken });
  } catch (err) {
    // Google expires sync tokens now and then (410 Gone). Start over with a
    // full listing; unchanged events are skipped below, so this stays cheap.
    if (err.code === 410 && syncToken) {
      console.log(`Sync token expired for "${label}", doing a full re-check`);
      result = await googleApi.listEvents(userId, sourceCalendarId, {});
      tokenReset = true;
    } else {
      throw err;
    }
  }

  const { nextSyncToken } = result;
  // Whole events and series first, so an edited occurrence can find its series.
  const events = [...result.events].sort(
    (a, b) => (a.recurringEventId ? 1 : 0) - (b.recurringEventId ? 1 : 0)
  );

  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  for (const event of events) {
    assertNotCancelled(groupId);

    if (event.recurringEventId) {
      const outcome = await applyOccurrenceChange(
        userId, groupId, sourceCalendarId, mergedCalendarId, event, detailLevel
      );
      if (outcome === "inserted") inserted++;
      else if (outcome === "updated") updated++;
      else if (outcome === "deleted") deleted++;
      continue;
    }

    const existing = await db.getEventMapping(userId, groupId, sourceCalendarId, event.id);

    if (event.status === "cancelled") {
      // Event was deleted on the source calendar
      if (existing) {
        try {
          await googleApi.deleteEvent(userId, mergedCalendarId, existing.mergedEventId);
        } catch (e) {
          if (!isGone(e)) throw e; // already gone on our side is fine
        }
        await db.deleteEventMapping(userId, groupId, sourceCalendarId, event.id);
        deleted++;
      }
      continue;
    }

    // Already copied and not edited since: nothing to do.
    if (existing && existing.sourceUpdated && existing.sourceUpdated === event.updated) continue;

    const body = buildMergedEventBody(event, detailLevel);
    const mappingExtra = { sourceUpdated: event.updated || null };

    if (existing) {
      try {
        await googleApi.updateEvent(userId, mergedCalendarId, existing.mergedEventId, body);
        await db.saveEventMapping(
          userId, groupId, sourceCalendarId, event.id, existing.mergedEventId, mappingExtra
        );
        updated++;
        continue;
      } catch (e) {
        if (!isGone(e)) throw e;
        // Our copy was deleted by hand; fall through and re-create it.
      }
    }

    const created = await googleApi.insertEvent(userId, mergedCalendarId, body);
    await db.saveEventMapping(userId, groupId, sourceCalendarId, event.id, created.id, mappingExtra);
    inserted++;
  }

  // Save the new sync token. When nothing changed the old token still works,
  // so skip the write (this runs every couple of minutes).
  const tokenChanged = nextSyncToken && nextSyncToken !== syncToken;
  if (calConfig && tokenChanged && (events.length > 0 || !syncToken || tokenReset)) {
    const fresh = await db.getGroup(userId, groupId);
    if (fresh) {
      const updatedCalendars = fresh.sourceCalendars.map((c) =>
        c.id === sourceCalendarId ? { ...c, syncToken: nextSyncToken } : c
      );
      await db.updateGroup(userId, groupId, { sourceCalendars: updatedCalendars });
    }
  }
  if (!nextSyncToken) {
    console.warn(`Google returned no sync token for "${label}"; the next check will re-read it in full`);
  }

  if (inserted + updated + deleted > 0) {
    console.log(`Synced "${label}": +${inserted} added, ~${updated} updated, -${deleted} removed`);
  }

  return { inserted, updated, deleted };
}

// ---------------------------------------------------------------------------
// Sync all source calendars for a group
// ---------------------------------------------------------------------------

async function syncGroup(userId, groupId) {
  const group = await db.getGroup(userId, groupId);
  if (!group || !group.mergedCalendarId) {
    throw new Error(`Group ${groupId} not found or has no merged calendar`);
  }

  const results = [];
  for (const cal of group.sourceCalendars) {
    const r = await syncSourceCalendar(
      userId,
      groupId,
      cal.id,
      group.mergedCalendarId,
      cal.detailLevel || "full"
    );
    results.push({ calendarId: cal.id, summary: cal.summary, ...r });
  }

  await db.updateGroup(userId, groupId, { lastSyncedAt: new Date().toISOString() });
  return results;
}

// ---------------------------------------------------------------------------
// Remove all merged events for a source calendar (when unchecked)
// ---------------------------------------------------------------------------

async function purgeSourceCalendar(userId, groupId, sourceCalendarId, mergedCalendarId) {
  const mappings = await db.getMappingsForSourceCalendar(userId, groupId, sourceCalendarId);
  let removed = 0;

  for (const mapping of mappings) {
    assertNotCancelled(groupId);
    try {
      await googleApi.deleteEvent(userId, mergedCalendarId, mapping.mergedEventId);
    } catch (e) {
      if (!isGone(e)) throw e;
    }
    await db.deleteEventMapping(userId, groupId, sourceCalendarId, mapping.sourceEventId);
    removed++;
  }

  if (removed) console.log(`Removed ${removed} events from ${sourceCalendarId} on the shared calendar`);
  return { removed };
}

module.exports = {
  cancelGroup,
  uncancelGroup,
  syncSourceCalendar,
  syncGroup,
  purgeSourceCalendar,
  buildMergedEventBody,
};
