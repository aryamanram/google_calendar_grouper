const express = require("express");
const router = express.Router();
const { createOAuth2Client } = require("../services/googleApi");
const { saveUserTokens } = require("../models/firestore");
const { requireApiKey } = require("../middleware/auth");

// Optional comma-separated allow-list, e.g. "you@gmail.com". When set, nobody
// else can sign in and store their tokens in your database.
function isAllowedEmail(email) {
  const list = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length === 0 || list.includes(String(email || "").toLowerCase());
}

// The scopes we need:
// - calendar: full read/write to create merged calendars, insert events, manage ACLs
// - calendar.events.readonly would be enough for source calendars, but since we
//   also need to write to the merged calendar, full calendar scope is simpler.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

// ---------------------------------------------------------------------------
// GET /auth/login
//
// The extension opens this URL in a new tab. Google's consent screen appears,
// user approves, Google redirects to /auth/callback.
// ---------------------------------------------------------------------------
router.get("/login", (req, res) => {
  const client = createOAuth2Client();

  const url = client.generateAuthUrl({
    access_type: "offline",    // gives us a refresh_token
    prompt: "consent",         // force consent to always get refresh_token
    scope: SCOPES,
    // Pass a state param so we can identify the user after redirect.
    // For MVP, the extension sends its own generated user-id or we derive
    // one from the Google profile after token exchange.
    state: req.query.state || "",
  });

  res.redirect(url);
});

// ---------------------------------------------------------------------------
// GET /auth/callback
//
// Google redirects here after consent. We exchange the code for tokens,
// extract the user's Google ID, and store everything in Firestore.
// ---------------------------------------------------------------------------
router.get("/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get the user's Google profile to derive a stable user ID
    const { google } = require("googleapis");
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    const userId = profile.id; // stable numeric Google ID

    if (!isAllowedEmail(profile.email)) {
      console.warn(`Sign-in refused for ${profile.email} (not in ALLOWED_EMAILS)`);
      return res.status(403).send("This account isn't allowed to use this Calendar Grouper backend.");
    }

    await saveUserTokens(userId, tokens);
    require("../services/googleApi").forgetAuthClient(userId); // use the new tokens

    // Send a simple HTML page that posts a message back to the extension
    // so the popup knows auth succeeded.
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Calendar Grouper — Authorized</title></head>
      <body>
        <h2>Authorization successful!</h2>
        <p>You can close this tab and return to the extension.</p>
        <script>
          // Post the userId back to the extension via BroadcastChannel
          // The extension's background worker listens for this.
          try {
            const bc = new BroadcastChannel("calendar-grouper-auth");
            bc.postMessage({
              type: "AUTH_SUCCESS",
              userId: ${JSON.stringify(userId)},
              email: ${JSON.stringify(profile.email)},
            });
            bc.close();
          } catch (e) {
            // Fallback: the extension can poll /auth/status
          }
          setTimeout(() => window.close(), 2000);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Auth callback error:", err);
    res.status(500).json({ error: "Token exchange failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/calendars?userId=...
//
// Returns the user's calendar list so the popup can show checkboxes.
// ---------------------------------------------------------------------------
router.get("/calendars", requireApiKey, async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const { listCalendars, isManagedCalendar } = require("../services/googleApi");
    const { listGroups } = require("../models/firestore");
    const [calendars, groups] = await Promise.all([listCalendars(userId), listGroups(userId)]);

    // Hide our own merged calendars. Offering one as a source would copy the
    // merged calendar into itself and duplicate every event.
    const mergedIds = new Set(groups.map((g) => g.mergedCalendarId).filter(Boolean));
    const sources = calendars.filter((c) => !mergedIds.has(c.id) && !isManagedCalendar(c));

    // Return a simplified list — the popup only needs id, summary, and color
    const simplified = sources.map((c) => ({
      id: c.id,
      summary: c.summary,
      backgroundColor: c.backgroundColor,
      primary: c.primary || false,
    }));

    res.json({ calendars: simplified });
  } catch (err) {
    console.error("Failed to list calendars:", err);
    res.status(500).json({ error: "Failed to fetch calendars" });
  }
});

module.exports = router;
