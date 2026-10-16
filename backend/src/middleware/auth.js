const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Request authentication
//
// Once the backend has a public URL, anyone who finds it could otherwise call
// it. Two shared secrets keep it private:
//
//   API_KEY      sent by the extension as the `x-api-key` header
//   TICK_SECRET  sent by Cloud Scheduler as the `x-tick-secret` header
//
// When API_KEY isn't set (local development) requests are allowed through.
// Cloud mode refuses to start without both secrets (see index.js).
// ---------------------------------------------------------------------------

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  // timingSafeEqual needs equal lengths; compare lengths separately.
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function requireApiKey(req, res, next) {
  const expected = process.env.API_KEY;
  if (!expected) return next(); // local development
  if (safeEqual(req.get("x-api-key"), expected)) return next();
  res.status(401).json({ error: "Missing or wrong API key", code: "UNAUTHORIZED" });
}

function requireTickSecret(req, res, next) {
  const expected = process.env.TICK_SECRET;
  if (expected && safeEqual(req.get("x-tick-secret"), expected)) return next();
  res.status(401).json({ error: "Unauthorized" });
}

module.exports = { requireApiKey, requireTickSecret, safeEqual };
