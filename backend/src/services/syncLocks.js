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
// This lives in memory, which is correct for one server process. With
// several Cloud Run instances it would need to move into Firestore.
// ---------------------------------------------------------------------------

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
    try {
      return await fn();
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
