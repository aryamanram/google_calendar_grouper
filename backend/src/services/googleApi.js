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

/**
 * Returns an authenticated OAuth2 client for a given user.
 * Automatically refreshes the access token if expired.
 */
async function getAuthClient(userId) {
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

  return client;
}

function getCalendarClient(authClient) {
  return google.calendar({ version: "v3", auth: authClient });
}

// ---------------------------------------------------------------------------
// Calendar operations
// ---------------------------------------------------------------------------

/** List all calendars the user owns or subscribes to. */
async function listCalendars(userId) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  const res = await cal.calendarList.list();
  return res.data.items || [];
}

/** Create a new secondary calendar and return its metadata. */
async function createCalendar(userId, summary) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  const res = await cal.calendars.insert({
    requestBody: { summary },
  });
  return res.data; // { id, summary, ... }
}

/** Delete a calendar entirely. */
async function deleteCalendar(userId, calendarId) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  await cal.calendars.delete({ calendarId });
}

/**
 * List events that changed since `syncToken` or `updatedMin`.
 *
 * On first sync pass updatedMin as a far-past ISO string and no syncToken.
 * Google returns a nextSyncToken with the response — store it and pass it
 * on subsequent calls to get only deltas.
 */
async function listEvents(userId, calendarId, { syncToken, updatedMin } = {}) {
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
  } else if (updatedMin) {
    params.updatedMin = updatedMin;
    params.timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // last 30 days
    params.timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // next year
  }

  const allEvents = [];
  let pageToken;
  let nextSyncToken;

  do {
    if (pageToken) params.pageToken = pageToken;
    const res = await cal.events.list(params);
    allEvents.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  return { events: allEvents, nextSyncToken };
}

/** Insert an event into the merged calendar. */
async function insertEvent(userId, calendarId, eventBody) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  const res = await cal.events.insert({
    calendarId,
    requestBody: eventBody,
  });
  return res.data;
}

/** Update an existing event on the merged calendar. */
async function updateEvent(userId, calendarId, eventId, eventBody) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  const res = await cal.events.update({
    calendarId,
    eventId,
    requestBody: eventBody,
  });
  return res.data;
}

/** Delete an event from the merged calendar. */
async function deleteEvent(userId, calendarId, eventId) {
  const auth = await getAuthClient(userId);
  const cal = getCalendarClient(auth);
  await cal.events.delete({ calendarId, eventId });
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
  createOAuth2Client,
  getAuthClient,
  listCalendars,
  createCalendar,
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
