const { v4: uuidv4 } = require("uuid");
const googleApi = require("./googleApi");
const db = require("../models/firestore");

// ---------------------------------------------------------------------------
// Register watches for all source calendars in a group
// ---------------------------------------------------------------------------

async function registerWatchesForGroup(userId, groupId) {
  const group = await db.getGroup(userId, groupId);
  if (!group) throw new Error(`Group ${groupId} not found`);

  const results = [];

  for (const cal of group.sourceCalendars) {
    const channelId = uuidv4();

    try {
      const watch = await googleApi.watchCalendar(userId, cal.id, channelId);

      await db.saveWatchChannel({
        channelId: watch.channelId,
        resourceId: watch.resourceId,
        sourceCalendarId: cal.id,
        userId,
        groupId,
        expiration: watch.expiration,
      });

      results.push({ calendarId: cal.id, channelId: watch.channelId, expiration: watch.expiration });
      console.log(`Watch registered: ${cal.id} → channel ${watch.channelId}, expires ${new Date(watch.expiration).toISOString()}`);
    } catch (err) {
      console.error(`Failed to register watch for ${cal.id}:`, err.message);
      results.push({ calendarId: cal.id, error: err.message });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Stop watches for a group (used when deleting a group or removing a calendar)
// ---------------------------------------------------------------------------

async function stopWatchesForGroup(userId, groupId) {
  const group = await db.getGroup(userId, groupId);
  if (!group) return;

  // Find all watch channels that belong to this group
  for (const cal of group.sourceCalendars) {
    await stopWatchForCalendar(userId, groupId, cal.id);
  }
}

async function stopWatchForCalendar(userId, groupId, sourceCalendarId) {
  // We need to scan watchChannels for this user+group+calendar combo.
  // This is a small collection so a full scan is fine.
  const dbRef = db.getDb().collection("watchChannels");
  const snap = await dbRef
    .where("userId", "==", userId)
    .where("groupId", "==", groupId)
    .where("sourceCalendarId", "==", sourceCalendarId)
    .get();

  for (const doc of snap.docs) {
    const channel = doc.data();
    try {
      await googleApi.stopWatch(userId, channel.channelId, channel.resourceId);
      console.log(`Watch stopped: channel ${channel.channelId}`);
    } catch (err) {
      // 404 means the channel already expired — that's fine
      if (err.code !== 404) {
        console.error(`Failed to stop watch ${channel.channelId}:`, err.message);
      }
    }
    await db.deleteWatchChannel(channel.channelId);
  }
}

// ---------------------------------------------------------------------------
// Renewal job
//
// Google watch channels expire after ~7 days. This job runs hourly and
// renews any channel expiring within the next 24 hours.
// ---------------------------------------------------------------------------

const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const RENEWAL_INTERVAL_MS = 60 * 60 * 1000;     // run every hour

async function renewExpiringWatches() {
  console.log("Checking for expiring watch channels...");

  const expiring = await db.getExpiringWatchChannels(RENEWAL_WINDOW_MS);

  if (expiring.length === 0) {
    console.log("No watch channels need renewal");
    return;
  }

  console.log(`Found ${expiring.length} channel(s) to renew`);

  for (const channel of expiring) {
    try {
      // Stop the old channel
      try {
        await googleApi.stopWatch(channel.userId, channel.channelId, channel.resourceId);
      } catch (e) {
        // Already expired — fine
      }
      await db.deleteWatchChannel(channel.channelId);

      // Register a fresh one
      const newChannelId = uuidv4();
      const watch = await googleApi.watchCalendar(
        channel.userId,
        channel.sourceCalendarId,
        newChannelId
      );

      await db.saveWatchChannel({
        channelId: watch.channelId,
        resourceId: watch.resourceId,
        sourceCalendarId: channel.sourceCalendarId,
        userId: channel.userId,
        groupId: channel.groupId,
        expiration: watch.expiration,
      });

      console.log(`Renewed: ${channel.channelId} → ${watch.channelId}`);
    } catch (err) {
      console.error(`Failed to renew channel ${channel.channelId}:`, err.message);
    }
  }
}

function startWatchRenewalJob() {
  // Run once on startup, then every hour
  renewExpiringWatches().catch((err) =>
    console.error("Watch renewal job failed:", err)
  );

  setInterval(() => {
    renewExpiringWatches().catch((err) =>
      console.error("Watch renewal job failed:", err)
    );
  }, RENEWAL_INTERVAL_MS);

  console.log("Watch renewal job started (runs every hour)");
}

module.exports = {
  registerWatchesForGroup,
  stopWatchesForGroup,
  stopWatchForCalendar,
  renewExpiringWatches,
  startWatchRenewalJob,
};
