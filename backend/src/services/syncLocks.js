// ---------------------------------------------------------------------------
// One sync at a time per shared calendar
//
// Several things can start a sync: creating or updating the group, the
// "Sync now" button, the auto-sync timer, and Google webhooks. Running two
// at once on the same calendar could copy an event twice, so every sync
// goes through runExclusive().
//
// kind:
//   "job"        user-triggered work (create, update, sync now). Other user
//                actions get a 409 while it runs.
//   "background" auto-sync / webhook checks. These are short, so user
//                actions wait for them instead of failing.
//
// Two layers:
//   1. In memory: claimed synchronously, so code in this process can check
//      and claim with no gap.
//   2. A Firestore lease (models/firestore.js): Cloud Run can briefly run a
//      second instance, e.g. during a deploy, and only a shared lock stops both
//      from syncing the same calendar. The lease expires on its own if an
//      instance dies, and is renewed while a long sync runs.
// ---------------------------------------------------------------------------

const crypto = require("crypto");
const db = require("../models/firestore");

const LEASE_TTL_MS = 5 * 60 * 1000; // freed automatically this long after a crash
const LEASE_RENEW_MS = 60 * 1000;
const INSTANCE = process.env.K_REVISION || "local"; // Cloud Run sets K_REVISION

const active = new Map(); // groupId -> { kind, promise }

class GroupBusyError extends Error {
  constructor(kind) {
    super(
      kind === "background"
        ? "Checking for changes right now. Try again in a moment."
        : "Still copying events from the last change. Try again when it finishes."
    );
    this.code = "SYNC_IN_PROGRESS";
    this.kind = kind;
  }
}

function current(groupId) {
  return active.get(groupId) || null;
}

function isBusy(groupId) {
  return active.has(groupId);
}

/**
 * Run fn as the only sync for this group. Rejects with GroupBusyError
 * (code "SYNC_IN_PROGRESS") if another sync already holds the group.
 */
function runExclusive(groupId, kind, fn) {
  if (active.has(groupId)) {
    return Promise.reject(new GroupBusyError(active.get(groupId).kind));
  }
  const entry = { kind, promise: null };
  active.set(groupId, entry); // claim before fn starts, so nothing can sneak in
  entry.promise = (async () => {
    const owner = `${INSTANCE}:${crypto.randomUUID()}`;
    let renewTimer = null;
    try {
      const lease = await db.acquireLease(groupId, owner, kind, LEASE_TTL_MS);
      if (!lease.ok) throw new GroupBusyError(lease.kind); // another instance has it
      renewTimer = setInterval(() => {
        db.renewLease(groupId, owner, LEASE_TTL_MS).catch((err) =>
          console.warn(`Could not renew sync lease for ${groupId}: ${err.message}`)
        );
      }, LEASE_RENEW_MS);
      renewTimer.unref?.();
      try {
        return await fn();
      } finally {
        clearInterval(renewTimer);
        await db.releaseLease(groupId, owner).catch((err) =>
          console.warn(`Could not release sync lease for ${groupId}: ${err.message}`)
        );
      }
    } finally {
      if (active.get(groupId) === entry) active.delete(groupId);
    }
  })();
  return entry.promise;
}

/** Resolve once whatever sync is running on this group has finished. */
async function waitForIdle(groupId) {
  const entry = active.get(groupId);
  if (entry) await entry.promise.catch(() => {});
}

/**
 * For user actions: wait out a short background check, but report a
 * user-triggered job as busy. Returns the busy kind, or null if it's free.
 */
async function waitForBackground(groupId) {
  const entry = active.get(groupId);
  if (!entry) return null;
  if (entry.kind !== "background") return entry.kind;
  await entry.promise.catch(() => {});
  return active.has(groupId) ? active.get(groupId).kind : null;
}

module.exports = {
  GroupBusyError,
  current,
  isBusy,
  runExclusive,
  waitForIdle,
  waitForBackground,
};
