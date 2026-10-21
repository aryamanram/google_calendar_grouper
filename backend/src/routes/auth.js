const express = require("express");
const router = express.Router();
const { createOAuth2Client } = require("../services/googleApi");
const { saveUserTokens } = require("../models/firestore");
const { requireApiKey } = require("../middleware/auth");
const { IS_CLOUD } = require("../runMode");
const { allowedEmails, extensionIds, EXTENSION_ID_PATTERN } = require("../config");

// ALLOWED_EMAILS lists the Google accounts that may sign in, e.g.
// "you@gmail.com partner@gmail.com". Nobody else can store their tokens in
// your database. Required in cloud mode (index.js refuses to start without
// it); optional locally.
function isAllowedEmail(email) {
  const list = allowedEmails();
  if (list.length === 0) return !IS_CLOUD; // never open sign-in to everyone in the cloud
  return list.includes(String(email || "").toLowerCase());
}

// The extension that started a sign-in, if it's one this backend accepts.
// Locally, with no EXTENSION_ID set, any well-formed ID is accepted.
function acceptedExtensionId(id) {
  if (!EXTENSION_ID_PATTERN.test(String(id || ""))) return null;
  const ids = extensionIds();
  if (ids.length === 0) return IS_CLOUD ? null : id;
  return ids.includes(id) ? id : null;
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
// GET /auth/login[?ext=<extension id>]
//
// Sends the browser to Google's consent screen; Google then redirects to
// /auth/callback.
//
// The extension opens this with chrome.identity.launchWebAuthFlow and its own
// ID in `ext`. The ID rides through Google in the OAuth `state`, so the
// callback can hand the signed-in account back to that extension. Opened
// without `ext` (for example by hand while testing), sign-in still works and
// ends on a plain success page.
// ---------------------------------------------------------------------------
router.get("/login", (req, res) => {
  if (req.query.ext && !acceptedExtensionId(req.query.ext)) {
    return res
      .status(403)
      .send("This copy of the extension isn't allowed to use this backend. Add its ID to EXTENSION_ID.");
  }

  const client = createOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: "offline", // gives us a refresh_token
    prompt: "consent",      // always ask, so Google always returns a refresh_token
    scope: SCOPES,
    state: req.query.ext ? `ext:${req.query.ext}` : "",
  });

  res.redirect(url);
});

// ---------------------------------------------------------------------------
// GET /auth/callback
//
// Google redirects here after consent. We exchange the code for tokens,
// look up the account, check it's allowed, and store the tokens.
// ---------------------------------------------------------------------------
router.get("/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(page("Sign-in cancelled", "Google didn't grant access. Close this window and try again."));
  }
  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // The Google profile gives a stable user ID and the email to check.
    const { google } = require("googleapis");
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    const userId = profile.id; // stable numeric Google ID

    if (!isAllowedEmail(profile.email)) {
      console.warn(`Sign-in refused for ${profile.email} (not in ALLOWED_EMAILS)`);
      return res
        .status(403)
        .send(page("Account not allowed", "This Google account isn't allowed to use this Calendar Grouper backend."));
    }

    await saveUserTokens(userId, tokens);
    require("../services/googleApi").forgetAuthClient(userId); // use the new tokens
    console.log(`Signed in: ${profile.email}`);

    // Started from the extension: send the account back to it. Chrome catches
    // this chromiumapp.org address and returns it to launchWebAuthFlow; the
    // page itself never loads.
    const state = String(req.query.state || "");
    const ext = state.startsWith("ext:") ? acceptedExtensionId(state.slice(4)) : null;
    if (ext) {
      const fragment = new URLSearchParams({ userId, email: profile.email || "" });
      return res.redirect(`https://${ext}.chromiumapp.org/signed-in#${fragment}`);
    }

    res.send(page("Authorization successful!", "You can close this tab."));
  } catch (err) {
    console.error("Auth callback error:", err);
    res.status(500).json({ error: "Token exchange failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/check
//
// Lets the extension's setup screen confirm the backend URL and API key work.
// ---------------------------------------------------------------------------
router.get("/check", requireApiKey, (_req, res) => {
  res.json({ ok: true });
});

function page(title, message) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Calendar Grouper</title></head>
<body style="font-family: Roboto, Arial, sans-serif; padding: 48px; color: #202124">
<h2 style="font-weight: 400">${title}</h2><p style="color: #5f6368">${message}</p></body></html>`;
}

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
