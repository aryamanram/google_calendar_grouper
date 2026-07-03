# Calendar Grouper — Setup Guide

This guide takes you from zero to a working local setup. It's built in **phases**, and each phase ends with a checkpoint you can verify before moving on. If something breaks, you'll know exactly which phase to look at.

**The strategy:** we get the whole thing working locally first, with one deliberate simplification — sync runs *manually* instead of via live webhooks. The sync engine is identical either way; the only difference is what triggers it. Live webhooks need a publicly verified HTTPS domain (explained in Phase 10), which is a later milestone, not part of first bring-up.

**Two known things you'll hit (both expected):**
- The automatic sign-in handoff into the extension isn't wired up yet — Phase 7 has a clean manual workaround.
- Watch (webhook) registration will fail on localhost — that's Phase 8, and it's fine.

---

## Phase 0 — Prerequisites

**What you need:**
- A Google account (the one whose calendars you want to group)
- Google Chrome
- Node.js 20 or newer
- The `calendar-grouper/` project folder

**Verify Node:**
```bash
node --version
```
You want `v20.x` or higher. If you're below that, install the latest LTS from nodejs.org.

> **Why Node 20+?** The backend uses `node --watch` for auto-reload during development, which is a built-in flag that only exists from Node 18.11+, and `firebase-admin` v12 targets Node 18+. Sticking to 20 keeps you clear of edge cases.

**Checkpoint:** `node --version` prints v20 or higher.

---

## Phase 1 — Google Cloud project & APIs

Everything we do lives inside one Google Cloud project. Think of a project as a container that holds your API access, credentials, and database.

1. Go to https://console.cloud.google.com
2. At the top, click the project dropdown → **New Project**.
3. Name it something like `calendar-grouper`. Click **Create**.
4. Wait for it to provision, then make sure it's selected in the top dropdown.

**Enable the two APIs we need:**

5. In the search bar, type **"Google Calendar API"**, open it, click **Enable**.
6. Search **"Cloud Firestore API"**, open it, click **Enable**.

**Create the Firestore database:**

7. In the left menu (or search), go to **Firestore**.
8. Click **Create database**.
9. Choose **Native mode** (not Datastore mode — they're different and the SDK expects Native).
10. Pick a location close to you (e.g. `us-central1` or `nam5`). This can't be changed later, but for a learning project any choice is fine.
11. Start in **test mode** if asked (we control access via the backend's service account anyway).

> **What's happening:** Firestore is where the backend stores its small bits of state — your OAuth tokens, your calendar-group config, and the event-mapping table that remembers "source event X → merged event Y." It never stores the calendar events themselves; those stay on Google's calendar servers.

**Checkpoint:** Both APIs show as "Enabled," and you can see an empty Firestore database in the console.

---

## Phase 2 — OAuth consent screen & credentials

This is the part that lets your app ask "can I access your calendar?" and get a yes. It has two pieces: the **consent screen** (what the user sees) and the **credentials** (the client ID and secret your backend uses).

### 2a — Consent screen

1. Left menu → **APIs & Services** → **OAuth consent screen**.
2. Choose **External** (unless you have a Google Workspace org and want Internal). Click **Create**.
3. Fill in the required fields:
   - App name: `Calendar Grouper`
   - User support email: your email
   - Developer contact email: your email
4. Click **Save and Continue**.
5. **Scopes** step: click **Add or Remove Scopes**, then manually add this scope:
   ```
   https://www.googleapis.com/auth/calendar
   ```
   Also add:
   ```
   https://www.googleapis.com/auth/userinfo.email
   ```
   Save and continue.
6. **Test users** step: click **Add Users** and add **your own Google email**. This is critical — while the app is in "Testing" mode, only listed test users can sign in.
7. Save and continue to the summary.

> **Why test users matter:** The calendar scope is "sensitive," and Google normally requires a verification review before the public can use it. But in **Testing** mode, you can skip verification entirely as long as only your added test users sign in. For a personal project this is exactly what you want — no review needed.

### 2b — OAuth credentials

8. Left menu → **APIs & Services** → **Credentials**.
9. Click **Create Credentials** → **OAuth client ID**.
10. Application type: **Web application**.
11. Name: `Calendar Grouper Backend`.
12. Under **Authorized redirect URIs**, click **Add URI** and enter exactly:
    ```
    http://localhost:3000/auth/callback
    ```
13. Click **Create**.
14. A dialog shows your **Client ID** and **Client secret**. Copy both somewhere safe — you'll paste them into `.env` in Phase 4.

> **Why localhost is allowed here:** Google normally requires HTTPS for redirect URIs, but it makes a deliberate exception for `http://localhost`, precisely so developers can build locally. This is why the *auth flow* works on your machine even though *webhooks* (Phase 10) won't.

**Checkpoint:** You have a Client ID (ends in `.apps.googleusercontent.com`) and a Client secret in hand, and your own email is listed as a test user.

---

## Phase 3 — Service account for Firestore

The backend needs its own identity to read and write Firestore. That identity is a **service account**, and it authenticates with a key file.

1. Left menu → **IAM & Admin** → **Service Accounts**.
2. Click **Create Service Account**.
3. Name: `calendar-grouper-backend`. Click **Create and Continue**.
4. Grant it a role: search for and select **Cloud Datastore User** (this covers Firestore read/write). Click **Continue**, then **Done**.
5. Back on the service accounts list, click your new account.
6. Go to the **Keys** tab → **Add Key** → **Create new key** → **JSON** → **Create**.
7. A `.json` file downloads. **Rename it to `service-account-key.json`** and move it into your `backend/` folder.

> **Security note:** This key grants database access, so it's in `.gitignore` already — never commit it. For production you'd use a more secure mechanism (Cloud Run gives the service identity automatically, no key file), but a key file is the simplest way to develop locally.

**Checkpoint:** `backend/service-account-key.json` exists.

---

## Phase 4 — Configure & run the backend

Now we wire your credentials into the backend and start it.

1. In `backend/`, copy the env template:
   ```bash
   cd backend
   cp .env.example .env
   ```
2. Open `.env` and fill it in:
   ```
   GOOGLE_CLIENT_ID=<paste from Phase 2b>
   GOOGLE_CLIENT_SECRET=<paste from Phase 2b>
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

   GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
   FIRESTORE_PROJECT_ID=<your project id>

   PORT=3000
   BACKEND_URL=http://localhost:3000

   EXTENSION_ID=<leave blank for now — we fill this in Phase 6>
   ```
   Your **project ID** is in the Cloud Console project dropdown (it's the lowercase id, not the display name — e.g. `calendar-grouper-481523`).

3. Install dependencies and start:
   ```bash
   npm install
   npm run dev
   ```

You should see:
```
Firestore initialized
Watch renewal job started (runs every hour)
Calendar Grouper backend listening on :3000
```

4. In another terminal (or your browser), hit the health check:
   ```bash
   curl http://localhost:3000/health
   ```
   Expect: `{"status":"ok"}`

> **If it crashes on startup:** the most common cause is Firestore credentials. Double-check `GOOGLE_APPLICATION_CREDENTIALS` points to the right file path (relative to `backend/`) and `FIRESTORE_PROJECT_ID` matches your actual project id. The error message usually names the problem.

**Checkpoint:** The server logs "listening on :3000" and `/health` returns ok.

---

## Phase 5 — Test the OAuth flow in your browser (no extension yet)

This is the smartest debugging move in the whole guide: we verify Google Cloud + OAuth + Firestore all work **together**, completely independent of the extension. If this works, you've de-risked the hardest part.

1. With the backend running, open this in your browser:
   ```
   http://localhost:3000/auth/login
   ```
2. Google's consent screen appears. You may see a **"Google hasn't verified this app"** warning — this is expected in Testing mode. Click **Advanced** → **Go to Calendar Grouper (unsafe)**. (It's your own app; it's safe.)
3. Approve the calendar permissions.
4. You'll land on a page that says **"Authorization successful!"**

**Now confirm the tokens landed in Firestore:**

5. Go to the Firebase/Firestore console → your database.
6. You should see a `users` collection with one document. **The document ID is your Google user ID** — a long number like `103847562910847562910`.
7. Copy that user ID. You'll need it in Phase 7.

> **What just happened end to end:** your browser → backend `/auth/login` → Google consent → Google redirected to backend `/auth/callback` with a one-time code → backend exchanged that code for access + refresh tokens → backend looked up your Google profile to get a stable user ID → backend saved the tokens to Firestore under that ID. Every link in that chain just got verified.

**Checkpoint:** A `users/{yourUserId}` document exists in Firestore. You've copied the user ID.

---

## Phase 6 — Build & load the Chrome extension

1. Build the popup:
   ```bash
   cd extension/popup
   npm install
   npm run build
   ```
   This produces `extension/popup/dist/`.

2. Load it into Chrome:
   - Go to `chrome://extensions`
   - Turn on **Developer mode** (top-right toggle)
   - Click **Load unpacked**
   - Select the `extension/` folder (the one with `manifest.json`, **not** the popup folder)

3. The extension appears in your list. **Copy its ID** — a long string of letters like `abcdefghijklmnopabcdefghijklmnop`.

4. Paste that ID into `backend/.env`:
   ```
   EXTENSION_ID=abcdefghijklmnopabcdefghijklmnop
   ```

5. **Restart the backend** (Ctrl+C, then `npm run dev` again) so it picks up the new env value.

> **Why the backend needs the extension ID:** the backend's CORS policy only accepts requests from `chrome-extension://<your-id>`. Without this, the popup's calls to the backend get blocked by the browser. The ID stays stable as long as you don't move the `extension/` folder, so you only set this once.

> **If the popup is blank when you click the icon:** right-click the popup → **Inspect** to open its devtools, and check the Console. If you see a Content-Security-Policy error about scripts, that's a known Vite-on-MV3 wrinkle and we'll adjust the Vite config together — tell me what the console says.

**Checkpoint:** The extension is loaded, you have its ID in `.env`, and the backend has been restarted.

---

## Phase 7 — Connect the extension to your account (manual handoff)

Here's the known gap: after Phase 5, your tokens are in Firestore, but the extension doesn't yet know your user ID automatically. We'll set it manually so you can keep moving. (Wiring up the automatic version is our first real feature task — see "Next: things we'll build" at the bottom.)

1. Go to `chrome://extensions`, find Calendar Grouper, and click the **service worker** link (under "Inspect views"). This opens the background worker's devtools console.

2. In that console, paste this — using **your** user ID from Phase 5 and your own email:
   ```javascript
   chrome.storage.local.set(
     { userId: "PASTE_YOUR_USER_ID", email: "you@gmail.com" },
     () => console.log("Auth state set")
   );
   ```
   Press Enter. You should see "Auth state set."

3. Click the extension icon to open the popup. It should now skip the sign-in screen and **load your calendars** — you'll see Main, Birthdays, Family, Food, and the rest, each with a checkbox.

> **What's happening:** the popup asks the background worker for the stored auth state on open. By writing `userId` and `email` into `chrome.storage.local` directly, we've simulated what the automatic handoff *will* do. The popup then calls the backend's `/auth/calendars?userId=...` endpoint, which uses your saved tokens to fetch your real calendar list from Google.

**Checkpoint:** The popup shows your actual Google calendars with checkboxes and the blue/red detail dots.

---

## Phase 8 — Create your group & sync events

1. In the popup:
   - Set the **shared calendar name** (e.g. "My full schedule").
   - **Check** the calendars you want included; **uncheck** ones like Food or Free if you don't want them shared.
   - For any calendar, **click its colored dot** to toggle between full details (blue) and busy-only (red).
   - Click **Create**.

2. Watch the backend logs. You'll see something like:
   ```
   Synced <calendar> → <merged>: +12 ~0 -0
   Failed to register watch for <calendar>: ...
   ```
   The **sync line is success** — events were copied into the merged calendar. The **watch failure is expected on localhost** (see note below).

3. Open Google Calendar (calendar.google.com). Under **My calendars** or **Other calendars**, you should now see **"My full schedule"**, and its events should mirror the calendars you selected.

> **Why the watch registration fails locally — and why that's OK:** Google Calendar push notifications require the callback URL to be HTTPS on a domain you've verified with Google. `localhost` is neither, so `events.watch()` is rejected. The backend is built to expect this — it catches the error per-calendar and continues, so your group is still created and the initial sync still runs. You just don't get *automatic* live updates yet.

4. **To re-sync after changing events** (since webhooks aren't firing locally), trigger a manual sync. Get your group ID first:
   ```bash
   curl "http://localhost:3000/groups?userId=YOUR_USER_ID"
   ```
   Find the `id` field, then:
   ```bash
   curl -X POST http://localhost:3000/groups/GROUP_ID/sync \
     -H "Content-Type: application/json" \
     -d '{"userId":"YOUR_USER_ID"}'
   ```
   This runs the exact same sync engine the webhook would trigger — so you're testing the real code path, just pulling the trigger by hand.

> **Try the full cycle:** add an event to your "Work" calendar in Google Calendar, run the manual sync command, and refresh — it should appear on "My full schedule." Then delete it, sync again, and watch it disappear. That's the diff-and-reconcile engine working.

**Checkpoint:** "My full schedule" exists in Google Calendar and contains events from your selected calendars. Manual sync reflects changes.

---

## Phase 9 — Test sharing

1. In the popup, type an email address into **Share with** and click **Share**.
   - Use a second Google account you control if you can, so you can verify the receiving end.
2. The backend grants that email read access to the merged calendar via the Calendar ACL API.
3. Verify it worked one of two ways:
   - The recipient gets an email from Google Calendar about a shared calendar, and can add it. It shows up as **one toggleable calendar** containing your full schedule.
   - Or, in Google Calendar → "My full schedule" → Settings and sharing → **Share with specific people**, you'll see the email listed with "See all event details."

> **This is the whole point of the project:** the recipient sees a single calendar they can toggle on and off, containing everything you chose to share — without you having shared each calendar individually, and without merging your own organized calendars together.

**Checkpoint:** The shared email appears in the merged calendar's sharing settings (or the recipient can see your schedule as one calendar).

---

## Phase 10 — (Later milestone) Live webhooks

This is where we make sync instant instead of manual. It's deliberately last because it requires infrastructure the earlier phases don't.

**What live sync needs:**
1. A **public HTTPS endpoint** for Google to POST to (your `BACKEND_URL` must be reachable from the internet).
2. **Domain verification** — Google requires the webhook domain to be verified through Search Console and registered in your Cloud project's domain settings. This is the real gatekeeper.

**Why localhost and `*.run.app` don't cut it:**
- localhost isn't reachable from the internet at all.
- A default Cloud Run URL like `myapp.run.app` is on a domain *Google* owns, so you can't verify ownership of it.

**The realistic path (we'll do this together when you're ready):**
1. Deploy the backend to **Google Cloud Run** (the `Dockerfile` is ready). You get a `*.run.app` URL with HTTPS automatically.
2. Buy/use a domain you own (even a cheap one), and **map it to your Cloud Run service** as a custom domain.
3. **Verify that domain** in Google Search Console, and add it to your Cloud project's verified domains.
4. Set `BACKEND_URL` to your custom domain, redeploy.
5. Now `events.watch()` succeeds, Google starts POSTing to `/webhooks/calendar`, and edits sync within seconds. The hourly renewal job (already built) keeps the 7-day watch channels alive.

Once webhooks are live, the manual sync command from Phase 8 becomes just a debugging tool — you won't need it for normal use.

---

## Quick troubleshooting reference

| Symptom | Likely phase | First thing to check |
|---|---|---|
| Backend won't start | 4 | Firestore credentials path + project ID in `.env` |
| "Access blocked / not verified" on sign-in | 2a | Is your email added as a test user? |
| Sign-in succeeds but no Firestore doc | 5 | Backend logs during `/auth/callback`; redirect URI matches exactly |
| Popup is blank | 6 | Inspect popup → Console; likely a CSP/Vite issue |
| Popup shows sign-in, won't load calendars | 7 | Did `chrome.storage.local` get set with the right user ID? |
| Calendar calls fail with CORS error | 6 | `EXTENSION_ID` in `.env` matches the loaded extension; backend restarted |
| "Failed to register watch" in logs | 8 | Expected on localhost — ignore until Phase 10 |
| Events don't appear on merged calendar | 8 | Run manual sync; check backend logs for the `+/~/-` line |

---

## Next: things we'll build together

These are the natural follow-ups once the core works — each is a good learning chunk:

1. **Automatic auth handoff** (replaces the Phase 7 manual step). Make the sign-in tab hand the user ID back to the extension cleanly — likely via `chrome.tabs.onUpdated` watching for the callback URL, or switching to `chrome.identity.launchWebAuthFlow`.
2. **Live webhooks** (Phase 10) — deploy + domain verification.
3. **Multiple groups** — the backend already supports this; the popup just needs UI to manage more than one.
4. **A real extension icon** — swap the placeholder `assets/icon128.png`.

Work through the phases in order, and when you hit something, tell me the phase number and the exact error or log line — that's usually enough to pinpoint it fast.
