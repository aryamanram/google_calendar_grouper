const { google } = require("googleapis");
const { getUserTokens, saveUserTokens } = require("../models/firestore");

// ---------------------------------------------------------------------------
// OAuth2 client factory
// ---------------------------------------------------------------------------

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Cache each user's client briefly so a sync doesn't re-read their tokens from
// Firestore for every single API call.
const authCache = new Map(); // userId -> { client, at }
const AUTH_CACHE_MS = 10 * 60 * 1000;

/** Drop a cached client (call after the user signs in again). */
function forgetAuthClient(userId) {
  authCache.delete(userId);
}

/**
 * Returns an authenticated OAuth2 client for a given user.
 * Automatically refreshes the access token if expired.
 */
async function getAuthClient(userId) {
  const hit = authCache.get(userId);
  if (hit && Date.now() - hit.at < AUTH_CACHE_MS) return hit.client;

  const tokens = await getUserTokens(userId);
  if (!tokens) throw new Error(`No tokens found for user ${userId}`);

  const client = createOAuth2Client();
  client.setCredentials(tokens);

  // Listen for automatic token refresh so we persist the new access token.
  client.on("tokens", async (newTokens) => {
    await saveUserTokens(userId, {
      ...tokens,
      access_token: newTokens.access_token,
      expiry_date: newTokens.expiry_date,
    });
  });

  authCache.set(userId, { client, at: Date.now() });
  return client;
}

function getCalendarClient(authClient) {
  return google.calendar({ version: "v3", auth: authClient });
}

// ---------------------------------------------------------------------------
// Merged calendars are tagged in their description so we can always tell
// them apart from the user's own calendars (never offer them as a source,
// and find them during cleanup even if Firestore lost track of them).
// ---------------------------------------------------------------------------
const MANAGED_TAG = "[managed-by-calendar-grouper]";

function isManagedCalendar(cal) {
  return typeof cal.description === "string" && cal.description.includes(MANAGED_TAG);
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
//
// Google returns 403 rateLimitExceeded / userRateLimitExceeded or 429 when we
// write events too quickly, and occasional 5xx errors. Those are temporary,
// so we wait and try again: ~0.5s, 1s, 2s, 4s, 8s (+ random jitter).
// Anything else (bad request, not found, daily quota) fails immediately.
//
// Inserts are the exception for 5xx: Google may have created the item before
// the error, and retrying would create a duplicate. A rate-limit rejection
// means nothing was created, so those are still retried.
// ---------------------------------------------------------------------------
const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const MAX_ATTEMPTS = 6;

function isRetryable(err, { idempotent = true } = {}) {
  const code = err.code || err.response?.status;
  if (code === 429) return true;
  if (code >= 500 && code < 600) return idempotent;
  if (code === 403) {
    const reason = err.errors?.[0]?.reason || err.response?.data?.error?.errors?.[0]?.reason;
    return RETRYABLE_REASONS.has(reason);
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, label = "Google API call", options = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err, options)) throw err;
      const delay = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      console.warn(`${label} rate-limited (attempt ${attempt}), retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

// ---------------------------------------------------------------------------
// Calendar operations
// ---------------------------------------------------------------------------

/** List all calendars the user owns or subscribes to. */
async function listCalendars(userId) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  const res = await withRetry(() => cal.calendarList.list(), "calendarList.list");
  return res.data.items || [];
}

/** Create a new secondary calendar and return its metadata. */
async function createCalendar(userId, summary) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  const res = await withRetry(
    () =>
      cal.calendars.insert({
        requestBody: {
          summary,
          description: `Shared view of my schedule. ${MANAGED_TAG}`,
        },
      }),
    "calendars.insert",
    { idempotent: false }
  );
  return res.data; // { id, summary, ... }
}

/** Rename a calendar (used when the shared calendar's name is edited). */
async function renameCalendar(userId, calendarId, summary) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  await withRetry(
    () => cal.calendars.patch({ calendarId, requestBody: { summary } }),
    "calendars.patch"
  );
}

/** Delete a calendar entirely. */
async function deleteCalendar(userId, calendarId) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  await withRetry(() => cal.calendars.delete({ calendarId }), "calendars.delete");
}

/**
 * List events on a calendar.
 *
 * First sync (no syncToken): returns every event that ends after 30 days ago
 * (recurring series included). Google also returns a nextSyncToken — store it
 * and pass it next time to get only what changed since.
 *
 * Only timeMin is used, as in Google's own incremental-sync example; timeMin,
 * timeMax and updatedMin can't be combined with a syncToken later anyway.
 */
async function listEvents(userId, calendarId, { syncToken } = {}) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);

  const params = {
    calendarId,
    maxResults: 2500,
    singleEvents: false, // keep recurring event masters
    showDeleted: true,    // so we can detect deletions
  };

  if (syncToken) {
    params.syncToken = syncToken;
  } else {
    params.timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // last 30 days
  }

  const allEvents = [];
  let pageToken;
  let nextSyncToken;

  do {
    if (pageToken) params.pageToken = pageToken;
    const res = await withRetry(() => cal.events.list({ ...params }), "events.list");
    allEvents.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return { events: allEvents, nextSyncToken };
}

/** Fetch one event by ID, or null if it doesn't exist. */
async function getEvent(userId, calendarId, eventId) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  try {
    const res = await withRetry(() => cal.events.get({ calendarId, eventId }), "events.get");
    return res.data;
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === 410) return null;
    throw err;
  }
}

/**
 * Find one occurrence of a recurring event by its original start time.
 * Used to edit or cancel a single occurrence of a series on the shared
 * calendar. originalStart is an RFC3339 date-time, or YYYY-MM-DD for
 * all-day events.
 */
async function findInstance(userId, calendarId, recurringEventId, originalStart) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  try {
    const res = await withRetry(
      () =>
        cal.events.instances({
          calendarId,
          eventId: recurringEventId,
          originalStart,
          showDeleted: true,
          maxResults: 1,
        }),
      "events.instances"
    );
    if (res.data.items?.length) return res.data.items[0];
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code !== 400 && code !== 404 && code !== 410) throw err;
  }

  // Fallback: Google names occurrences "<seriesId>_<start>", using
  // YYYYMMDDTHHMMSSZ (UTC) for timed events and YYYYMMDD for all-day ones.
  const suffix = /^\d{4}-\d{2}-\d{2}$/.test(originalStart)
    ? originalStart.replace(/-/g, "")
    : new Date(originalStart).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return getEvent(userId, calendarId, `${recurringEventId}_${suffix}`);
}

/** Insert an event into the merged calendar. */
async function insertEvent(userId, calendarId, eventBody) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  const res = await withRetry(
    () => cal.events.insert({ calendarId, requestBody: eventBody }),
    "events.insert",
    { idempotent: false }
  );
  return res.data;
}

/** Update an existing event on the merged calendar. */
async function updateEvent(userId, calendarId, eventId, eventBody) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  const res = await withRetry(
    () => cal.events.update({ calendarId, eventId, requestBody: eventBody }),
    "events.update"
  );
  return res.data;
}

/** Delete an event from the merged calendar. */
async function deleteEvent(userId, calendarId, eventId) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  await withRetry(() => cal.events.delete({ calendarId, eventId }), "events.delete");
}

// ---------------------------------------------------------------------------
// Sharing (ACLs)
// ---------------------------------------------------------------------------

/** Grant read access to the merged calendar for a given email. */
async function shareCalendar(userId, calendarId, email) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  const res = await cal.acl.insert({
    calendarId,
    requestBody: {
      role: "reader",
      scope: { type: "user", value: email },
    },
  });
  return res.data;
}

/** Remove read access from the merged calendar. */
async function unshareCalendar(userId, calendarId, email) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  // ACL rule IDs for user scopes follow the pattern "user:<email>"
  await cal.acl.delete({
    calendarId,
    ruleId: `user:${email}`,
  });
}

// ---------------------------------------------------------------------------
// Watch channels (push notifications)
// ---------------------------------------------------------------------------

/**
 * Register a watch channel on a calendar.
 * Returns { channelId, resourceId, expiration }.
 */
async function watchCalendar(userId, calendarId, channelId) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);

  const res = await cal.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: `${process.env.BACKEND_URL}/webhooks/calendar`,
      // Request max expiration — Google caps at ~7 days
      params: { ttl: "604800" },
    },
  });

  return {
    channelId: res.data.id,
    resourceId: res.data.resourceId,
    expiration: parseInt(res.data.expiration, 10),
  };
}

/** Stop (unregister) a watch channel. */
async function stopWatch(userId, channelId, resourceId) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  await cal.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  MANAGED_TAG,
  isManagedCalendar,
  withRetry,
  isRetryable,
  createOAuth2Client,
  getAuthClient,
  forgetAuthClient,
  getEvent,
  findInstance,
  listCalendars,
  createCalendar,
  renameCalendar,
  deleteCalendar,
  listEvents,
  insertEvent,
  updateEvent,
  deleteEvent,
  shareCalendar,
  unshareCalendar,
  watchCalendar,
  stopWatch,
};
