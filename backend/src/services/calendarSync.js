const googleApi = require("./googleApi");
const db = require("../models/firestore");

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

// ---------------------------------------------------------------------------
// Sync a single source calendar into the merged calendar
// ---------------------------------------------------------------------------

/**
 * Syncs events from one source calendar into the merged calendar.
 *
 * @param {string} userId
 * @param {string} groupId
 * @param {string} sourceCalendarId
 * @param {string} mergedCalendarId
 * @param {string} detailLevel  "full" | "busy"
 */
async function syncSourceCalendar(userId, groupId, sourceCalendarId, mergedCalendarId, detailLevel) {
  // Retrieve stored sync token for incremental sync
  const group = await db.getGroup(userId, groupId);
  const calConfig = (group.sourceCalendars || []).find((c) => c.id === sourceCalendarId);
  const syncToken = calConfig?.syncToken || null;

  let result;
  try {
    result = await googleApi.listEvents(userId, sourceCalendarId, {
      syncToken,
      // First sync: go back 30 days, forward 1 year
      updatedMin: syncToken ? undefined : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    // If the sync token is invalid (410 Gone), do a full re-sync
    if (err.code === 410) {
      console.log(`Sync token expired for ${sourceCalendarId}, doing full resync`);
      result = await googleApi.listEvents(userId, sourceCalendarId, {
        updatedMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    } else {
      throw err;
    }
  }

  const { events, nextSyncToken } = result;

  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  for (const event of events) {
    // Skip cancelled-but-not-mapped events (nothing to do)
    const existing = await db.getEventMapping(userId, groupId, sourceCalendarId, event.id);

    if (event.status === "cancelled") {
      // Event was deleted on the source calendar
      if (existing) {
        try {
          await googleApi.deleteEvent(userId, mergedCalendarId, existing.mergedEventId);
        } catch (e) {
          // Already deleted on merged side — that's fine
          if (e.code !== 404 && e.code !== 410) throw e;
        }
        await db.deleteEventMapping(userId, groupId, sourceCalendarId, event.id);
        deleted++;
      }
      continue;
    }

    const body = buildMergedEventBody(event, detailLevel);

    if (existing) {
      // Update existing merged event
      try {
        await googleApi.updateEvent(userId, mergedCalendarId, existing.mergedEventId, body);
        updated++;
      } catch (e) {
        if (e.code === 404) {
          // Merged event was somehow deleted — re-insert
          const created = await googleApi.insertEvent(userId, mergedCalendarId, body);
          await db.saveEventMapping(userId, groupId, sourceCalendarId, event.id, created.id);
          inserted++;
        } else {
          throw e;
        }
      }
    } else {
      // New event — insert into merged calendar
      const created = await googleApi.insertEvent(userId, mergedCalendarId, body);
      await db.saveEventMapping(userId, groupId, sourceCalendarId, event.id, created.id);
      inserted++;
    }
  }

  // Persist the new sync token so next call is incremental
  if (nextSyncToken && calConfig) {
    const updatedCalendars = group.sourceCalendars.map((c) =>
      c.id === sourceCalendarId ? { ...c, syncToken: nextSyncToken } : c
    );
    await db.updateGroup(userId, groupId, { sourceCalendars: updatedCalendars });
  }

  // Update last synced timestamp
  await db.updateGroup(userId, groupId, { lastSyncedAt: new Date().toISOString() });

  console.log(
    `Synced ${sourceCalendarId} → ${mergedCalendarId}: +${inserted} ~${updated} -${deleted}`
  );

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
    results.push({ calendarId: cal.id, ...r });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Remove all merged events for a source calendar (when unchecked)
// ---------------------------------------------------------------------------

async function purgeSourceCalendar(userId, groupId, sourceCalendarId, mergedCalendarId) {
  const mappings = await db.getMappingsForSourceCalendar(userId, groupId, sourceCalendarId);
  let removed = 0;

  for (const mapping of mappings) {
    try {
      await googleApi.deleteEvent(userId, mergedCalendarId, mapping.mergedEventId);
    } catch (e) {
      if (e.code !== 404 && e.code !== 410) throw e;
    }
    await db.deleteEventMapping(userId, groupId, sourceCalendarId, mapping.sourceEventId);
    removed++;
  }

  console.log(`Purged ${removed} events from ${sourceCalendarId} in group ${groupId}`);
  return { removed };
}

module.exports = {
  syncSourceCalendar,
  syncGroup,
  purgeSourceCalendar,
  buildMergedEventBody,
};
