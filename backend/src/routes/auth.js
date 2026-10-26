const express = require("express");
const router = express.Router();
const { createOAuth2Client } = require("../services/googleApi");
const { saveUserTokens } = require("../models/firestore");
const { requireSession } = require("../middleware/auth");
const access = require("../services/access");
const { extensionIds, EXTENSION_ID_PATTERN } = require("../config");

// The extension that started a sign-in, if this backend accepts it. With
// EXTENSION_ID unset (the default) any copy of the extension may sign in:
// access is decided by the Google account (owners and invited members), not
// by which copy of the extension asks. Set EXTENSION_ID to restrict it.
function acceptedExtensionId(id) {
  if (!EXTENSION_ID_PATTERN.test(String(id || ""))) return null;
  const ids = extensionIds();
  return ids.length === 0 || ids.includes(id) ? id : null;
}

// The narrowest scopes that cover what the backend does. Google's
// verification review asks for exactly this, and people see a shorter, less
// alarming consent screen.
//   calendarlist.readonly  list your calendars, so you can pick sources
//   events.readonly        read events on the calendars you picked (and
//                          watch them for changes); never write to them
//   app.created            create the shared calendar, rename or delete it,
//                          and write the copied events into it; it can't
//                          touch any calendar this app didn't create
//   acls                   share the shared calendar with the people you add
//   userinfo.email         who you are, to check you're allowed to sign in
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.acls",
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

    // Google lets people untick individual permissions. Without all of them
    // syncing fails later in confusing ways, so stop here and say so.
    const granted = new Set(String(tokens.scope || "").split(/\s+/));
    const missing = SCOPES.filter((s) => !granted.has(s));
    if (tokens.scope && missing.length) {
      console.warn(`Sign-in missing permissions: ${missing.join(" ")}`);
      return res
        .status(400)
        .send(
          page(
            "Calendar Grouper needs every permission",
            "Some boxes were unticked on Google's permissions screen. Close this window and sign in again, leaving all of them ticked."
          )
        );
    }
    client.setCredentials(tokens);

    // The Google profile gives a stable user ID and the email to check.
    const { google } = require("googleapis");
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    const userId = profile.id; // stable numeric Google ID

    if (!(await access.isAllowed(profile.email))) {
      console.warn(`Sign-in refused for ${profile.email} (not an owner or invited member)`);
      return res
        .status(403)
        .send(
          page(
            "You haven't been invited yet",
            `${escapeHtml(profile.email)} doesn't have access to this Calendar Grouper backend. Ask the person who runs it to invite this address, then try again.`
          )
        );
    }

    await saveUserTokens(userId, tokens, profile.email);
    require("../services/googleApi").forgetAuthClient(userId); // use the new tokens
    console.log(`Signed in: ${profile.email}`);

    // Started from the extension: send the account back to it. Chrome catches
    // this chromiumapp.org address and returns it to launchWebAuthFlow; the
    // page itself never loads.
    const state = String(req.query.state || "");
    const ext = state.startsWith("ext:") ? acceptedExtensionId(state.slice(4)) : null;
    if (ext) {
      // The session token identifies this person on every later request.
      const token = await access.createSession(userId, profile.email);
      const fragment = new URLSearchParams({ token, userId, email: profile.email || "" });
      return res.redirect(`https://${ext}.chromiumapp.org/signed-in#${fragment}`);
    }

    res.send(page("Authorization successful!", "You can close this tab."));
  } catch (err) {
    console.error("Auth callback error:", err);
    res.status(500).json({ error: "Token exchange failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/me: who the session belongs to, and whether they're an owner.
// POST /auth/logout: end this session.
// ---------------------------------------------------------------------------
router.get("/me", requireSession, (req, res) => {
  res.json({ userId: req.user.userId, email: req.user.email, isOwner: access.isOwner(req.user.email) });
});

router.post("/logout", requireSession, async (req, res, next) => {
  try {
    await access.endSession(req.user.token);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

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
router.get("/calendars", requireSession, async (req, res) => {
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
