const admin = require("firebase-admin");

let db;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function initFirestore() {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIRESTORE_PROJECT_ID,
  });
  db = admin.firestore();
  console.log("Firestore initialized");
}

function getDb() {
  if (!db) throw new Error("Firestore not initialized — call initFirestore() first");
  return db;
}

// ---------------------------------------------------------------------------
// Users & Tokens
// ---------------------------------------------------------------------------

async function saveUserTokens(userId, tokens) {
  await getDb().collection("users").doc(userId).set(
    {
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function getUserTokens(userId) {
  const doc = await getDb().collection("users").doc(userId).get();
  return doc.exists ? doc.data().tokens : null;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function createGroup(userId, group) {
  const ref = getDb()
    .collection("users")
    .doc(userId)
    .collection("groups")
    .doc();

  const data = {
    name: group.name,
    mergedCalendarId: group.mergedCalendarId || null,
    sourceCalendars: group.sourceCalendars || [],
    // sourceCalendars: [{ id, summary, detailLevel: "full" | "busy" }]
    sharedWith: group.sharedWith || [],
    // "syncing" while events are being copied, then "ready" or "error"
    status: group.status || "ready",
    lastError: null,
    lastSyncedAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await ref.set(data);
  return { id: ref.id, ...data };
}

async function getGroup(userId, groupId) {
  const doc = await getDb()
    .collection("users")
    .doc(userId)
    .collection("groups")
    .doc(groupId)
    .get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function updateGroup(userId, groupId, updates) {
  await getDb()
    .collection("users")
    .doc(userId)
    .collection("groups")
    .doc(groupId)
    .update({ ...updates, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
}

async function listGroups(userId) {
  const snap = await getDb()
    .collection("users")
    .doc(userId)
    .collection("groups")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Every group for every user (used by the auto-sync timer). */
async function listAllGroups() {
  const snap = await getDb().collectionGroup("groups").get();
  return snap.docs.map((d) => ({
    id: d.id,
    userId: d.ref.parent.parent.id, // users/{userId}/groups/{groupId}
    ...d.data(),
  }));
}

async function deleteGroup(userId, groupId) {
  const groupRef = getDb()
    .collection("users")
    .doc(userId)
    .collection("groups")
    .doc(groupId);

  // A Firestore batch holds at most 500 writes, and a group can have
  // thousands of event mappings, so delete them in chunks.
  const mappings = await groupRef.collection("eventMappings").get();
  const docs = mappings.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = getDb().batch();
    docs.slice(i, i + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  await groupRef.delete();
}

// ---------------------------------------------------------------------------
// Event Mappings
//
// Each document: { sourceCalendarId, sourceEventId, mergedEventId, sourceUpdated }
// sourceUpdated is the source event's "updated" timestamp when we last copied
// it, so unchanged events can be skipped instead of rewritten.
// Doc ID = `${sourceCalendarId}_${sourceEventId}` (deterministic so upserts
// are simple).
// ---------------------------------------------------------------------------

function mappingDocId(sourceCalendarId, sourceEventId) {
  // Calendar IDs contain @ and . which are fine in Firestore doc IDs.
  // Event IDs are opaque strings. Combine with a separator unlikely to clash.
  return `${sourceCalendarId}::${sourceEventId}`;
}

async function saveEventMapping(
  userId,
  groupId,
  sourceCalendarId,
  sourceEventId,
  mergedEventId,
  extra = {}
) {
  const docId = mappingDocId(sourceCalendarId, sourceEventId);
  await getDb()
    .collection("users")
    .doc(userId)
    .collection("groups")
    .doc(groupId)
    .collection("eventMappings")
    .doc(docId)
    .set({ sourceCalendarId, sourceEventId, mergedEventId, ...extra });
}

async function getEventMapping(userId, groupId, sourceCalendarId, sourceEventId) {
  const docId = mappingDocId(sourceCalendarId, sourceEventId);
  const doc = await getDb()
    .collection("users")
    .doc(userId)
    .collection("groups")
    .doc(groupId)
    .collection("eventMappings")
    .doc(docId)
    .get();
  return doc.exists ? doc.data() : null;
}

async function deleteEventMapping(userId, groupId, sourceCalendarId, sourceEventId) {
  const docId = mappingDocId(sourceCalendarId, sourceEventId);
  await getDb()
    .collection("users")
    .doc(userId)
    .collection("groups")
    .doc(groupId)
    .collection("eventMappings")
    .doc(docId)
    .delete();
}

async function getMappingsForSourceCalendar(userId, groupId, sourceCalendarId) {
  const snap = await getDb()
    .collection("users")
    .doc(userId)
    .collection("groups")
    .doc(groupId)
    .collection("eventMappings")
    .where("sourceCalendarId", "==", sourceCalendarId)
    .get();
  return snap.docs.map((d) => d.data());
}

// ---------------------------------------------------------------------------
// Watch Channels
//
// Stored at top level so the webhook handler can look up by channel ID
// without knowing the user ahead of time.
// ---------------------------------------------------------------------------

async function saveWatchChannel(channel) {
  // channel: { channelId, resourceId, sourceCalendarId, userId, groupId, expiration }
  await getDb().collection("watchChannels").doc(channel.channelId).set(channel);
}

async function getWatchChannel(channelId) {
  const doc = await getDb().collection("watchChannels").doc(channelId).get();
  return doc.exists ? doc.data() : null;
}

async function deleteWatchChannel(channelId) {
  await getDb().collection("watchChannels").doc(channelId).delete();
}

async function getExpiringWatchChannels(withinMs) {
  const cutoff = Date.now() + withinMs;
  const snap = await getDb()
    .collection("watchChannels")
    .where("expiration", "<", cutoff)
    .get();
  return snap.docs.map((d) => d.data());
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  initFirestore,
  getDb,
  // tokens
  saveUserTokens,
  getUserTokens,
  // groups
  createGroup,
  getGroup,
  updateGroup,
  listGroups,
  listAllGroups,
  deleteGroup,
  // event mappings
  saveEventMapping,
  getEventMapping,
  deleteEventMapping,
  getMappingsForSourceCalendar,
  // watch channels
  saveWatchChannel,
  getWatchChannel,
  deleteWatchChannel,
  getExpiringWatchChannels,
};
