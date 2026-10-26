# Local setup

This guide runs your own copy of Calendar Grouper on your computer: a Google Cloud project, the backend on `localhost`, and the extension loaded in Chrome. It takes about 30 minutes. Each phase ends with a checkpoint; don't move on until it passes.

When you're done, [the deploy guide](./deploy.md) moves the backend to Google Cloud so it keeps syncing with your computer off.

Google changes its console often. If a screen doesn't match what's described here, [open an issue](https://github.com/aryamanram/google_calendar_grouper/issues) with a screenshot.

## Phase 0 — Prerequisites

```bash
node --version
```

You need **v20 or higher**. If you don't have it, install the LTS release from https://nodejs.org.

**✅ Checkpoint:** Node prints v20 or higher.

---

## Phase 1 — Project, APIs, and Firestore

### 1a — Create the project
1. https://console.cloud.google.com → **project picker** (top bar) → **New project**.
2. **Project name:** `calendar-grouper`. Leave Organization as "No organization." Click **Create**.
3. When it's ready, make sure the new project is **selected** in the project picker. Every step from here happens inside this project.
4. Write down the **project ID** (shown in the picker; it's the lowercase one with a suffix).

### 1b — Enable the APIs
1. Top search bar → type **Google Calendar API** → open it → **Enable**.
2. Top search bar → type **Cloud Firestore API** → open it → **Enable**.

### 1c — Create the Firestore database
1. Top search bar → **Firestore** → **Create database**.
2. Fill it in exactly like this:
   - **Database ID:** `(default)` (include the parentheses; the backend connects to this name)
   - **Edition:** **Standard Edition** (automatic indexes; Enterprise makes you manage them by hand)
   - **Mode:** **Firestore in Native mode**
   - **Security rules:** **Restrictive** (the backend uses the Admin SDK, which bypasses rules, so locking out everyone else is the right choice)
   - **Location:** anything near you, such as `nam5` or `us-central1`
3. Click **Create Database**.

**✅ Checkpoint:** Both APIs show "Enabled," and an empty `(default)` Firestore database exists.

---

## Phase 2 — OAuth (Google Auth Platform)

The OAuth settings now live in the **Google Auth Platform**, which has separate tabs for Branding, Audience, Data Access, and Clients.

### 2a — Run the "Get started" wizard
1. **☰ menu** → **APIs & Services** → **OAuth consent screen**. This opens the Google Auth Platform.
2. Click **Get started**.
3. **App information:** App name `Calendar Grouper`, User support email = your email → **Next**.
4. **Audience:** **External** → **Next**. This choice can't be changed later, and External is the right one for a personal Gmail account.
5. **Contact information:** your email → **Next**.
6. **Finish:** check the box to agree to the User Data Policy → **Continue** → **Create**.
7. You'll land on the **Overview** page (Metrics / Project Checkup). There's nothing to do there.

### 2b — Add scopes
1. Left sidebar → **Data Access** → **Add or remove scopes**.
2. Scroll to **Manually add scopes** at the bottom of the panel and paste these five (one per line):
   ```
   https://www.googleapis.com/auth/calendar.calendarlist.readonly
   https://www.googleapis.com/auth/calendar.events.readonly
   https://www.googleapis.com/auth/calendar.app.created
   https://www.googleapis.com/auth/calendar.acls
   https://www.googleapis.com/auth/userinfo.email
   ```
3. Click **Add to table** → **Update** → **Save** at the bottom of the page.
4. A "sensitive scope / verification" notice is expected. You can ignore it while the app is in Testing mode.

### 2c — Add yourself as a test user
1. Left sidebar → **Audience** → scroll to **Test users** → **+ Add users**.
2. Enter **your own Gmail address** → **Save**.

If you skip this, sign-in will fail with an "access blocked" error.

### 2d — Create the OAuth client
1. Left sidebar → **Clients** → **+ Create client**.
2. **Application type:** **Web application**.
3. **Name:** `Calendar Grouper Backend`.
4. **Authorized JavaScript origins:** leave empty.
5. **Authorized redirect URIs** → **+ Add URI** → paste exactly:
   ```
   http://localhost:3000/auth/callback
   ```
   It must be `http`, port `3000`, with no trailing slash.
6. Click **Create**.
7. **Copy the Client ID and Client secret right away**, or click **Download JSON**. You can't view the secret again after closing the dialog.

**✅ Checkpoint:** You have a Client ID (ends in `.apps.googleusercontent.com`) and a Client secret, and your email is listed under Test users.

---

## Phase 3 — Service account key for Firestore

1. **☰ menu** → **IAM & Admin** → **Service Accounts** → **+ Create service account**.
2. **Name:** `calendar-grouper-backend` → **Create and continue**.
3. **Role:** search for and select **Cloud Datastore User** → **Continue** → **Done**.
4. Click the new service account's email in the list → **Keys** tab → **Add key** → **Create new key** → **JSON** → **Create**. A `.json` file downloads.
5. Rename the file to `service-account-key.json` and move it to **`backend/service-account-key.json`**, next to `package.json`.
6. From the repo root, run:
   ```bash
   git status
   ```
   The key must **not** appear in the output. If it does, stop: `.gitignore` isn't working, and committing the key would expose your database.

Key creation can be blocked by an organization policy on Workspace accounts. This is rare on a personal Gmail account.

**✅ Checkpoint:** The key is in `backend/`, and git ignores it.

---

## Phase 4 — Configure and start the backend

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and fill it in:

```
GOOGLE_CLIENT_ID=<Client ID from 2d>
GOOGLE_CLIENT_SECRET=<Client secret from 2d>
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
FIRESTORE_PROJECT_ID=<project ID from 1a>

PORT=3000
BACKEND_URL=http://localhost:3000

```

Then install and start the server:

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

**Leave this terminal running.** Open a **second terminal** and test it:
```bash
curl http://localhost:3000/health
```
The expected response is `{"status":"ok"}`.

**✅ Checkpoint:** The server is listening, and `/health` returns ok.

---

## Phase 5 — Test sign-in in the browser (no extension yet)

1. Open http://localhost:3000/auth/login in your browser.
2. Choose your Google account.
3. At **"Google hasn't verified this app,"** click **Continue**. (On some versions of the screen it's **Advanced** → **Go to Calendar Grouper**.)
4. On the permissions screen, **make sure every calendar permission checkbox is checked.** Google lets you untick individual permissions, and if any calendar one is unticked, later steps fail. Then click **Continue**.
5. You should see **"Authorization successful!"**
6. Go to the Cloud console → **Firestore** → **Firestore Studio** (or **Data**). You should see a `users` collection containing one document, named with your Google user ID.

**✅ Checkpoint:** A `users/<yourUserId>` document exists.

---

## Phase 6 — Build and load the extension

In your second terminal:

```bash
cd extension/popup
npm install
npm run build
```

Then load it in Chrome:

1. Go to `chrome://extensions` → turn on **Developer mode** (toggle in the top right).
2. Click **Load unpacked** → select the **`extension/`** folder (the one containing `manifest.json`, not `popup/`).
If the popup opens blank, right-click inside it → **Inspect** → **Console** tab to see the error.

**✅ Checkpoint:** The extension's card appears in `chrome://extensions` with no errors.

---

## Phase 7 — Connect the extension and sign in

1. Click the extension icon in the toolbar. The popup shows **Connect**.
2. Paste `http://localhost:3000` and click **Connect**.
3. Click **Sign in with Google**. Google's consent screen opens in its own window; approve it as in Phase 5. The window closes on its own.
4. Open the popup again. Your real calendars should load, each with a checkbox and a detail dot.

**✅ Checkpoint:** The popup lists your actual calendars, and your email is shown at the bottom.

---

## Phase 8 — Create the group and sync

1. In the popup:
   - Name the shared calendar.
   - Check the calendars to include.
   - Click a calendar's dot to switch between **blue** (full details) and **red** (busy only).
   - Click **Create**.
2. Watch the backend logs:
   - `Synced "Work": +N added ...` means it worked.
   - `Watch not registered for ...` is **expected on localhost** and is not a bug. Live webhooks need a public, verified HTTPS domain, which is a later milestone.
3. Open Google Calendar. The merged calendar should appear, containing your events.
4. New, edited and deleted events sync on their own. The backend checks every 2 minutes (`SYNC_POLL_SECONDS` in `.env`), so a change shows up on the shared calendar within a couple of minutes. To sync immediately, click **Sync now** in the popup.
5. Test the full cycle: add an event to Work and wait about 2 minutes. It appears on the shared calendar. Delete it, and it disappears on the next check. Editing or deleting a single occurrence of a repeating event works the same way.

**✅ Checkpoint:** The merged calendar mirrors the calendars you selected, and changes appear within a couple of minutes without any manual step.

---

## Phase 9 — Share it

1. In the popup, under **Share with**, enter an email → **Share**. A second Google account of your own is ideal for testing.
2. To confirm, open Google Calendar → the merged calendar → **⋮** → **Settings and sharing** → **Share with specific people**. The email should be listed there.

**✅ Checkpoint:** The recipient can add your whole schedule as one calendar they can toggle on and off.

---

## Heads-up: the 7-day token limit

While the app is in **Testing** mode, Google expires refresh tokens after about 7 days. If sync suddenly stops working a week later, that's the cause, not a code bug. Re-run Phase 5 to sign in again. Publishing the app (part of [the deploy guide](./deploy.md), step 3) removes the limit.

---

## Next: run it with your computer off

Everything above runs on your laptop. To keep syncing while it's off, follow **[the deploy guide](./deploy.md)**. It moves the backend to Cloud Run with a 2-minute Cloud Scheduler check, and fits in Google Cloud's free tier.

---

## Troubleshooting

| Symptom | Phase | Check first |
|---|---|---|
| `redirect_uri_mismatch` | 2d | The redirect URI matches exactly: http, port 3000, no trailing slash |
| "Access blocked" at sign-in | 2c | Your email is listed under Test users |
| Backend crashes on start | 4 | The key file path and the project ID in `.env` |
| Calendar API 403 / insufficient scopes | 5 | Every calendar checkbox was ticked during consent, and Data Access lists all five scopes; sign in again |
| Blank popup | 6 | Inspect the popup → Console for the error |
| CORS error in popup | 7 | `EXTENSION_ID` is set in `.env` and doesn't include this extension's ID. Remove it |
| "Watch not registered" | 8 | Expected on localhost; auto-sync covers it |
| New events don't appear | 8 | Wait 2 minutes or click **Sync now**; check the backend log for "Auto-sync failed" |
