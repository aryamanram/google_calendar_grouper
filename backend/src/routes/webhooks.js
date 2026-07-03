const express = require("express");
const router = express.Router();
const { getWatchChannel } = require("../models/firestore");
const { syncSourceCalendar } = require("../services/calendarSync");
const { getGroup } = require("../models/firestore");

// ---------------------------------------------------------------------------
// POST /webhooks/calendar
//
// Google sends a POST here whenever a watched calendar changes.
//
// The notification carries NO event data — just headers telling us which
// channel fired. We then look up the channel in Firestore to figure out
// which user and source calendar it belongs to, and run a sync.
//
// Headers from Google:
//   X-Goog-Channel-ID:    the channel ID we registered
//   X-Goog-Resource-ID:   opaque resource identifier
//   X-Goog-Resource-State: "sync" (initial handshake) | "exists" (change)
//   X-Goog-Message-Number: sequential counter
// ---------------------------------------------------------------------------

// Track in-flight syncs to avoid duplicate work when Google sends multiple
// notifications in quick succession for the same calendar.
const activeSyncs = new Set();

router.post("/calendar", async (req, res) => {
  const channelId = req.headers["x-goog-channel-id"];
  const resourceState = req.headers["x-goog-resource-state"];

  // Always respond 200 quickly — Google retries on non-2xx and we don't
  // want to queue up duplicate notifications.
  res.status(200).send("OK");

  // "sync" is the initial verification ping when a watch is first created.
  // No actual change happened — nothing to do.
  if (resourceState === "sync") {
    console.log(`Watch sync handshake for channel ${channelId}`);
    return;
  }

  if (!channelId) return;

  try {
    // Look up which user/group/calendar this channel belongs to
    const channel = await getWatchChannel(channelId);
    if (!channel) {
      console.warn(`Unknown channel ID: ${channelId} — possibly expired`);
      return;
    }

    const { userId, groupId, sourceCalendarId } = channel;

    // Deduplicate: if we're already syncing this exact calendar, skip
    const syncKey = `${userId}:${groupId}:${sourceCalendarId}`;
    if (activeSyncs.has(syncKey)) {
      console.log(`Sync already in progress for ${syncKey}, skipping`);
      return;
    }

    activeSyncs.add(syncKey);

    try {
      // Get the group to find the merged calendar ID and detail level
      const group = await getGroup(userId, groupId);
      if (!group || !group.mergedCalendarId) {
        console.warn(`Group ${groupId} not found or missing merged calendar`);
        return;
      }

      const calConfig = group.sourceCalendars.find((c) => c.id === sourceCalendarId);
      if (!calConfig) {
        console.warn(`Calendar ${sourceCalendarId} not in group ${groupId}`);
        return;
      }

      console.log(`Webhook fired: syncing ${sourceCalendarId} for user ${userId}`);
      await syncSourceCalendar(
        userId,
        groupId,
        sourceCalendarId,
        group.mergedCalendarId,
        calConfig.detailLevel || "full"
      );
    } finally {
      activeSyncs.delete(syncKey);
    }
  } catch (err) {
    console.error(`Webhook sync error for channel ${channelId}:`, err);
  }
});

module.exports = router;
