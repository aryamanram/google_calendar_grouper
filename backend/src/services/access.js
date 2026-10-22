const crypto = require("crypto");
const db = require("../models/firestore");
const { allowedEmails } = require("../config");
const { IS_CLOUD } = require("../runMode");

// ---------------------------------------------------------------------------
// Who may use this backend
//
// Owners:  the emails in ALLOWED_EMAILS. They run the backend, and from the
//          extension they can invite and remove people.
// Members: people an owner invited. Stored in Firestore (members/{email}),
//          so adding someone needs no redeploy.
//
// Locally, with ALLOWED_EMAILS unset, anyone can sign in and everyone is an
// owner. Cloud mode refuses to start without ALLOWED_EMAILS (see index.js).
// ---------------------------------------------------------------------------

const MEMBER_CACHE_MS = 30 * 1000;
let memberCache = { at: 0, emails: new Set() };

function normalize(email) {
  return String(email || "").trim().toLowerCase();
}

function ownerEmails() {
  return allowedEmails();
}

async function memberEmails() {
  if (Date.now() - memberCache.at > MEMBER_CACHE_MS) {
    const members = await db.listMembers();
    memberCache = { at: Date.now(), emails: new Set(members.map((m) => m.email)) };
  }
  return memberCache.emails;
}

function forgetMembers() {
  memberCache = { at: 0, emails: new Set() };
}

function isOwner(email) {
  const owners = ownerEmails();
  if (owners.length === 0) return !IS_CLOUD;
  return owners.includes(normalize(email));
}

async function isAllowed(email) {
  if (isOwner(email)) return true;
  return (await memberEmails()).has(normalize(email));
}

// ---------------------------------------------------------------------------
// Session tokens
//
// The extension gets a token when it signs in and sends it on every request
// as "Authorization: Bearer <token>". The token identifies the person, so the
// backend never trusts a user ID sent by the client. Only a hash is stored.
// ---------------------------------------------------------------------------

const SESSION_CACHE_MS = 60 * 1000;
const sessionCache = new Map(); // hash -> { session, at }

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function createSession(userId, email) {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.saveSession(hashToken(token), { userId, email: normalize(email) });
  return token;
}

async function lookupSession(token) {
  if (!token) return null;
  const hash = hashToken(token);
  const cached = sessionCache.get(hash);
  if (cached && Date.now() - cached.at < SESSION_CACHE_MS) return cached.session;

  const session = await db.getSession(hash);
  if (session) sessionCache.set(hash, { session, at: Date.now() });
  else sessionCache.delete(hash);
  return session;
}

async function endSession(token) {
  const hash = hashToken(token);
  sessionCache.delete(hash);
  await db.deleteSession(hash);
}

/** Sign someone out everywhere: every session of every account with this email. */
async function revokeEmail(email) {
  const users = await db.findUsersByEmail(normalize(email));
  for (const user of users) {
    const hashes = await db.deleteSessionsForUser(user.id);
    hashes.forEach((h) => sessionCache.delete(h));
  }
  // Also drop cached sessions for this email from accounts not found above.
  for (const [hash, { session }] of sessionCache) {
    if (session.email === normalize(email)) sessionCache.delete(hash);
  }
}

module.exports = {
  normalize,
  ownerEmails,
  memberEmails,
  forgetMembers,
  isOwner,
  isAllowed,
  createSession,
  lookupSession,
  endSession,
  revokeEmail,
};
