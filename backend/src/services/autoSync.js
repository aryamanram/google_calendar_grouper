const db = require("../models/firestore");
const { syncGroup } = require("./calendarSync");
const locks = require("./syncLocks");
const access = require("./access");

// ---------------------------------------------------------------------------
// Auto-sync
//
// Every SYNC_POLL_SECONDS (default 120), ask Google what changed on each
// source calendar and apply it to the shared calendar. Thanks to sync tokens
// this is one small request per calendar, and quiet calendars cost nothing
// beyond that request.
//
// Why this exists alongside webhooks: Google can only deliver webhooks to a
// verified public HTTPS domain, so on localhost they never arrive. Once the
// backend is deployed with webhooks working, this becomes a safety net that
// catches anything a webhook missed. You can raise the interval then.
// ---------------------------------------------------------------------------

const INTERVAL_SECONDS = Math.max(30, Number(process.env.SYNC_POLL_SECONDS) || 120);

let running = false;

/** One pass over every group. Returns a small summary (used by /internal/tick). */
async function pollOnce() {
  if (running) return { skipped: true, reason: "previous pass still running" };
  running = true;
  const summary = { groups: 0, changes: 0, errors: 0 };
  try {
    const groups = await db.listAllGroups();
    const allowedUsers = new Map(); // userId -> still has access?
    for (const g of groups) {
      if (locks.isBusy(g.id)) continue; // a create/update/webhook is already on it

      // Someone removed from the backend stops syncing. Accounts saved before
      // emails were recorded have none; keep syncing those so an upgrade
      // doesn't silently stop the owner's calendar. Signing in again records
      // the email, after which the normal check applies.
      if (!allowedUsers.has(g.userId)) {
        const user = await db.getUser(g.userId);
        allowedUsers.set(g.userId, !user?.email || (await access.isAllowed(user.email)));
      }
      if (!allowedUsers.get(g.userId)) continue;
      summary.groups++;

      try {
        await locks.runExclusive(g.id, "background", async () => {
          const results = await syncGroup(g.userId, g.id);
          const changes = results.reduce((n, r) => n + r.inserted + r.updated + r.deleted, 0);
          summary.changes += changes;
          if (changes) console.log(`Auto-sync "${g.name}": ${changes} change(s) applied`);

          // Heal a group left in "syncing" by a restart, or recover from an error.
          if (g.status !== "ready" || g.lastError) {
            await db.updateGroup(g.userId, g.id, { status: "ready", lastError: null });
          }
        });
      } catch (err) {
        if (err.code === "SYNC_IN_PROGRESS") continue;
        if (err.code === "LEASE_LOST") {
          // Another instance took over this group; it finishes the sync.
          console.warn(`Auto-sync for "${g.name}" stopped: ${err.message}`);
          continue;
        }
        summary.errors++;
        console.error(`Auto-sync failed for "${g.name}": ${err.message}`);
        await db
          .updateGroup(g.userId, g.id, { status: "error", lastError: err.message })
          .catch(() => {});
      }
    }
  } catch (err) {
    console.error("Auto-sync pass failed:", err.message);
    throw err;
  } finally {
    running = false;
  }
  return summary;
}

function startAutoSync() {
  const pass = () => pollOnce().catch(() => {}); // already logged
  setTimeout(pass, 5000); // first pass shortly after startup
  setInterval(pass, INTERVAL_SECONDS * 1000);
  console.log(`Auto-sync started (checks every ${INTERVAL_SECONDS}s)`);
}

module.exports = { startAutoSync, pollOnce, INTERVAL_SECONDS };
