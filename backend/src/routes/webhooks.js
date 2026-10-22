const express = require("express");
const router = express.Router();
const { getWatchChannel } = require("../models/firestore");
const { syncSourceCalendar } = require("../services/calendarSync");
const { getUser, getGroup, updateGroup } = require("../models/firestore");
const access = require("../services/access");
const locks = require("../services/syncLocks");

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

// Google often sends several notifications in a burst. If a sync is already
// running on this group we skip: the auto-sync timer catches anything missed.

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

    // Someone removed from the backend stops syncing (as in autoSync.js).
    const user = await getUser(userId);
    if (user?.email && !(await access.isAllowed(user.email))) return;

    if (locks.isBusy(groupId)) return;

    await locks.runExclusive(groupId, "background", async () => {
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

      await syncSourceCalendar(
        userId,
        groupId,
        sourceCalendarId,
        group.mergedCalendarId,
        calConfig.detailLevel || "full"
      );
      await updateGroup(userId, groupId, { lastSyncedAt: new Date().toISOString() });
    });
  } catch (err) {
    if (err.code === "SYNC_IN_PROGRESS" || err.code === "LEASE_LOST") return; // auto-sync catches up
    console.error(`Webhook sync error for channel ${channelId}:`, err);
  }
});

module.exports = router;
