// Tests for sign-in tokens, invites and access checks. Run: npm test
// Firestore and Google are replaced with in-memory fakes, so no credentials
// or network are needed.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.ALLOWED_EMAILS = "owner@example.com";
process.env.GOOGLE_CLIENT_ID = "test";
process.env.GOOGLE_CLIENT_SECRET = "test";
process.env.GOOGLE_REDIRECT_URI = "http://localhost/auth/callback";
delete process.env.EXTENSION_ID;

const src = (p) => path.join(__dirname, "..", "src", p);

// ---- In-memory Firestore ---------------------------------------------------
const store = { users: new Map(), sessions: new Map(), members: new Map(), groups: new Map() };
const fakeDb = {
  saveUserTokens: async (id, tokens, email) => store.users.set(id, { ...(store.users.get(id) || {}), tokens, email }),
  getUser: async (id) => (store.users.has(id) ? { id, ...store.users.get(id) } : null),
  findUsersByEmail: async (email) => [...store.users].filter(([, u]) => u.email === email).map(([id, u]) => ({ id, ...u })),
  saveSession: async (hash, s) => store.sessions.set(hash, s),
  getSession: async (hash) => store.sessions.get(hash) || null,
  deleteSession: async (hash) => store.sessions.delete(hash),
  deleteSessionsForUser: async (userId) => {
    const gone = [...store.sessions].filter(([, s]) => s.userId === userId).map(([h]) => h);
    gone.forEach((h) => store.sessions.delete(h));
    return gone;
  },
  listMembers: async () => [...store.members].map(([email, m]) => ({ email, ...m })),
  addMember: async (email, addedBy) => store.members.set(email, { addedBy, addedAt: Date.now() }),
  removeMember: async (email) => store.members.delete(email),
  listGroups: async (userId) => [...store.groups.values()].filter((g) => g.userId === userId),
};
require.cache[src("models/firestore.js")] = { id: src("models/firestore.js"), filename: src("models/firestore.js"), loaded: true, exports: fakeDb };

// ---- Fake Google sign-in -----------------------------------------------------
let nextProfile = { id: "u-owner", email: "owner@example.com" };
const fakeGoogleApi = {
  createOAuth2Client: () => ({
    generateAuthUrl: ({ state }) => `https://accounts.google.com/o/oauth2/auth?state=${encodeURIComponent(state)}`,
    getToken: async () => ({ tokens: { access_token: "a", refresh_token: "r" } }),
    setCredentials() {},
  }),
  forgetAuthClient() {},
  listCalendars: async () => [{ id: "c1", summary: "Work" }],
  isManagedCalendar: () => false,
};
require.cache[src("services/googleApi.js")] = { id: src("services/googleApi.js"), filename: src("services/googleApi.js"), loaded: true, exports: fakeGoogleApi };
const googleapis = require("googleapis");
googleapis.google.oauth2 = () => ({ userinfo: { get: async () => ({ data: nextProfile }) } });

// ---- App under test (routes only, no Firestore init) -------------------------
const express = require("express");
const { requireSession, requireOwner } = require(src("middleware/auth.js"));
const app = express();
app.use(express.json());
app.use("/auth", require(src("routes/auth.js")));
app.use("/people", requireSession, requireOwner, require(src("routes/people.js")));
app.get("/whoami", requireSession, (req, res) => res.json({ query: req.query.userId, user: req.user.userId }));

let server, base;
before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const EXT = "abcdefghijklmnopabcdefghijklmnop";

async function signIn(profile) {
  nextProfile = profile;
  const login = await fetch(`${base}/auth/login?ext=${EXT}`, { redirect: "manual" });
  const state = new URL(login.headers.get("location")).searchParams.get("state");
  const cb = await fetch(`${base}/auth/callback?code=x&state=${encodeURIComponent(state)}`, { redirect: "manual" });
  return cb;
}
function tokenFrom(res) {
  const loc = res.headers.get("location") || "";
  return new URLSearchParams(loc.split("#")[1] || "").get("token");
}
const call = (p, token, opts = {}) =>
  fetch(base + p, { ...opts, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

let ownerToken;

test("owner signs in and gets a token handed to the extension", async () => {
  const res = await signIn({ id: "u-owner", email: "Owner@Example.com" });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), new RegExp(`^https://${EXT}\\.chromiumapp\\.org/signed-in#`));
  ownerToken = tokenFrom(res);
  assert.ok(ownerToken && ownerToken.length >= 40);
  assert.ok(![...store.sessions.keys()].includes(ownerToken), "only the hash is stored");
  const me = await (await call("/auth/me", ownerToken)).json();
  assert.deepEqual(me, { userId: "u-owner", email: "owner@example.com", isOwner: true });
});

test("requests without a valid token are refused", async () => {
  assert.equal((await call("/auth/me")).status, 401);
  assert.equal((await call("/auth/me", "made-up")).status, 401);
});

test("the signed-in account replaces any userId the client sends", async () => {
  const body = await (await call("/whoami?userId=someone-else", ownerToken)).json();
  assert.deepEqual(body, { query: "u-owner", user: "u-owner" });
});

test("an uninvited account can't sign in", async () => {
  const res = await signIn({ id: "u-friend", email: "friend@example.com" });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /invite/i);
});

let friendToken;
test("owner invites a friend, who can then sign in but isn't an owner", async () => {
  const add = await call("/people", ownerToken, { method: "POST", body: JSON.stringify({ email: "Friend@Example.com" }) });
  assert.equal(add.status, 201);
  assert.deepEqual((await add.json()).members.map((m) => m.email), ["friend@example.com"]);

  const res = await signIn({ id: "u-friend", email: "friend@example.com" });
  assert.equal(res.status, 302);
  friendToken = tokenFrom(res);
  const me = await (await call("/auth/me", friendToken)).json();
  assert.equal(me.isOwner, false);
  assert.equal((await call("/people", friendToken)).status, 403, "members can't manage people");
});

test("invalid and owner emails are rejected", async () => {
  assert.equal((await call("/people", ownerToken, { method: "POST", body: JSON.stringify({ email: "nope" }) })).status, 400);
  assert.equal((await call("/people", ownerToken, { method: "POST", body: JSON.stringify({ email: "owner@example.com" }) })).status, 409);
  assert.equal((await call("/people/owner@example.com", ownerToken, { method: "DELETE" })).status, 400);
});

test("removing a friend signs them out straight away", async () => {
  const del = await call("/people/friend@example.com", ownerToken, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.deepEqual((await del.json()).members, []);
  assert.equal((await call("/auth/me", friendToken)).status, 401);
  assert.equal((await signIn({ id: "u-friend", email: "friend@example.com" })).status, 403);
});

test("sign out ends only that session", async () => {
  const second = tokenFrom(await signIn({ id: "u-owner", email: "owner@example.com" }));
  assert.equal((await call("/auth/logout", second, { method: "POST" })).status, 200);
  assert.equal((await call("/auth/me", second)).status, 401);
  assert.equal((await call("/auth/me", ownerToken)).status, 200);
});

test("EXTENSION_ID, when set, limits which copies can sign in", async () => {
  process.env.EXTENSION_ID = "ponmlkjihgfedcbaponmlkjihgfedcba";
  try {
    assert.equal((await fetch(`${base}/auth/login?ext=${EXT}`, { redirect: "manual" })).status, 403);
    assert.equal((await fetch(`${base}/auth/login?ext=ponmlkjihgfedcbaponmlkjihgfedcba`, { redirect: "manual" })).status, 302);
  } finally {
    delete process.env.EXTENSION_ID;
  }
});
