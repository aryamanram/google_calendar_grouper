const crypto = require("crypto");
const access = require("../services/access");

// ---------------------------------------------------------------------------
// Request authentication
//
// requireSession   the extension: "Authorization: Bearer <token>", the token
//                  it got when the person signed in (see routes/auth.js)
// requireOwner     after requireSession: only the backend's owners
// requireTickSecret Cloud Scheduler: "x-tick-secret: <TICK_SECRET>"
// ---------------------------------------------------------------------------

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  // timingSafeEqual needs equal lengths; compare lengths separately.
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function bearerToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") || "");
  return match ? match[1] : null;
}

async function requireSession(req, res, next) {
  try {
    const token = bearerToken(req);
    const session = await access.lookupSession(token);
    if (!session) {
      return res.status(401).json({ error: "Please sign in again.", code: "SIGNED_OUT" });
    }
    // Someone removed from the backend loses access straight away.
    if (!(await access.isAllowed(session.email))) {
      return res
        .status(403)
        .json({ error: "Your account no longer has access to this backend.", code: "NOT_ALLOWED" });
    }

    req.user = { userId: session.userId, email: session.email, token };

    // Routes read userId from the query or body. Overwrite whatever the
    // client sent with the signed-in account, so nobody can act as someone
    // else by changing it.
    if (req.query) req.query.userId = session.userId;
    if (req.body && typeof req.body === "object") req.body.userId = session.userId;
    next();
  } catch (err) {
    next(err);
  }
}

function requireOwner(req, res, next) {
  if (req.user && access.isOwner(req.user.email)) return next();
  res.status(403).json({ error: "Only the backend's owner can do this.", code: "NOT_OWNER" });
}

function requireTickSecret(req, res, next) {
  const expected = process.env.TICK_SECRET;
  if (expected && safeEqual(req.get("x-tick-secret"), expected)) return next();
  res.status(401).json({ error: "Unauthorized" });
}

module.exports = { requireSession, requireOwner, requireTickSecret, safeEqual, bearerToken };
