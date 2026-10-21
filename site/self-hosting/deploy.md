# Deploy to Google Cloud

This moves the backend from your laptop to **Google Cloud Run**. A **Cloud Scheduler** job wakes it every 2 minutes to check for new events. The extension stays exactly as it is and simply points at the cloud URL instead of `localhost`.

**What runs where afterwards**

| Piece | Where | Who needs it |
|---|---|---|
| Backend (sync engine) | Cloud Run, wakes on demand | Nobody touches it |
| Auto-sync timer | Cloud Scheduler, every 2 min | Nobody touches it |
| Database (settings, event map) | Firestore, unchanged | Nobody touches it |
| Shared calendar | Google Calendar | The people you share it with subscribe once. They need no extension or account setup. |
| Extension | Your Chrome | Only you, to change settings |

Your existing shared calendar carries over. The cloud backend uses the same Firestore database, so you don't need to recreate anything.

Run every command below in a terminal (macOS or Linux), **from the repo root** (`google_calendar_grouper/`), all in **one terminal window**. Later steps reuse variables set in earlier ones. If you close the window, re-run the 0c block first.

---

## 0 — One-time setup

### 0a. Install the gcloud CLI
```bash
brew install --cask google-cloud-sdk
gcloud auth login
```
(No Homebrew? Use the installer at https://cloud.google.com/sdk/docs/install.)

### 0b. Turn on billing and set a budget alert
Cloud Run and Cloud Scheduler need a billing account attached, even when usage stays inside the free tier.

1. Cloud console → **Billing** → link a billing account to `calendar-grouper-511703`.
2. **Billing → Budgets & alerts → Create budget**: amount **$1**, alerts at 50%, 90% and 100%.

Choose **Alerts only** for this budget, and keep **Free tier credits** checked under *Savings*, so the budget tracks what you'd actually pay. If it only offers "All projects (1)", that's the same thing while this billing account has one project.

A budget only *emails* you; it doesn't stop spending. At this project's size you should never see one of these emails. If you do, something is looping, and you want to know about it.

**Optional spending safeguard:** create a second budget with **Spend cap enforcement**, service **Cloud Run** only, amount **$10**. Spend caps currently cover only a few services, Cloud Run among them. A cap pauses Cloud Run once *estimated* spending reaches the target, but enforcement and billing data lag, so charges can go somewhat past $10. Caps also count cost *before* the free tier. Your auto-sync is roughly $1/month gross, so a $1 cap could pause syncing even though you pay nothing. Treat $10 as a brake on runaway usage, not a guaranteed maximum bill.

### 0c. Variables (re-run these if you open a new Terminal)
```bash
PROJECT_ID=calendar-grouper-511703
REGION=us-central1
SERVICE=calendar-grouper
SA=calendar-grouper-backend@$PROJECT_ID.iam.gserviceaccount.com
gcloud config set project $PROJECT_ID
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
URL=https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app
echo $URL
```
`URL` is the address your backend will have. Cloud Run URLs follow this pattern, so it's known before the first deploy.

### 0d. Enable the services
```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com
```

### 0e. Let Cloud Build build the container
New projects need this one grant for `gcloud run deploy --source`:
```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/run.builder
```

---

## 1 — Secrets

Three secrets go in **Secret Manager**, never in code or in the image:

| Secret | What it is |
|---|---|
| `GOOGLE_CLIENT_SECRET` | Your OAuth client secret (already in `backend/.env`) |
| `API_KEY` | A new random key the extension sends with every request, so only you can control the backend |
| `TICK_SECRET` | A new random key Cloud Scheduler sends, so only it can trigger syncs |

```bash
API_KEY=$(openssl rand -hex 32)
TICK_SECRET=$(openssl rand -hex 32)

printf %s "$API_KEY"     | gcloud secrets create API_KEY --data-file=-
printf %s "$TICK_SECRET" | gcloud secrets create TICK_SECRET --data-file=-
grep '^GOOGLE_CLIENT_SECRET=' backend/.env | cut -d= -f2- | tr -d '\n' \
  | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-

for s in API_KEY TICK_SECRET GOOGLE_CLIENT_SECRET; do
  gcloud secrets add-iam-policy-binding $s \
    --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done

echo "Save this API key in your password manager: $API_KEY"
```
Keep the API key: the extension needs it in step 6. You can always read it back with `gcloud secrets versions access latest --secret=API_KEY`.

The backend runs as the `calendar-grouper-backend` service account you made in Phase 3. It already has Firestore access, and the loop above lets it read these three secrets. The JSON key file stays on your laptop; Cloud Run doesn't use it.

---

## 2 — Deploy the backend
```bash
EXT_ID=$(grep '^EXTENSION_ID=' backend/.env | cut -d= -f2-)
CLIENT_ID=$(grep '^GOOGLE_CLIENT_ID=' backend/.env | cut -d= -f2-)

gcloud run deploy $SERVICE --source backend --region $REGION \
  --service-account $SA --allow-unauthenticated \
  --min-instances 0 --max-instances 1 --cpu 1 --memory 512Mi --timeout 900 \
  --set-env-vars "RUN_MODE=cloud,FIRESTORE_PROJECT_ID=$PROJECT_ID,GOOGLE_CLIENT_ID=$CLIENT_ID,GOOGLE_REDIRECT_URI=$URL/auth/callback,BACKEND_URL=$URL,EXTENSION_ID=$EXT_ID,ALLOWED_EMAILS=aryamanramchandran@gmail.com" \
  --set-secrets "GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,API_KEY=API_KEY:latest,TICK_SECRET=TICK_SECRET:latest"
```
- If it asks to create an Artifact Registry repository, answer **Y**.
- The first build takes 2–4 minutes.

What the flags mean:
- `--allow-unauthenticated`: the extension and Google's sign-in page must be able to reach the backend. The API key and tick secret are what keep it private.
- `--max-instances 1`: normally one copy of the backend, which also caps cost. Cloud Run can briefly run a second copy, for example during a deploy. A lock stored in Firestore (`syncLocks`) makes sure only one copy ever syncs a given calendar at a time.
- `--min-instances 0`: nothing runs, and nothing is billed, between requests.
- `--timeout 900`: gives a large first copy up to 15 minutes.

Check it:
```bash
curl $URL/health
```
Expect `{"status":"ok","mode":"cloud"}`. If it can't connect, confirm the URL Cloud Run printed at the end of the deploy matches `$URL`. It also lists the URL here: `gcloud run services describe $SERVICE --region $REGION --format='value(status.url)'`. If they differ, use the printed one, set `URL=` to it, and re-run step 2.

---

## 3 — Point Google sign-in at the cloud backend, and publish the app

In the Cloud console, open **Google Auth Platform**:

1. **Clients** → `Calendar Grouper Backend` → scroll to **Authorized redirect URIs** (*not* "Authorized JavaScript origins" above it, which rejects paths with "URIs must not contain a path") → **Add URI** → paste the output of `echo $URL/auth/callback` → **Save**. Keep the localhost URI too.
2. **Branding**: publishing needs a homepage and privacy policy on an authorized domain. This repo serves both from `docs/` with GitHub Pages: repo **Settings → Pages →** *Deploy from a branch*, `main`, `/docs`. Then fill in:
   - **Application home page:** `https://aryamanram.github.io/google_calendar_grouper/`
   - **Application privacy policy link:** `https://aryamanram.github.io/google_calendar_grouper/privacy.html`
   - **Authorized domains:** `aryamanram.github.io`
   - Skip the logo. Uploading one forces a verification review.
3. **Audience** → **Publish app** → **Confirm**. Status changes to **In production**. A "needs verification" notice appears; leave it, since it's not required at this size.

Why publish: while the app is in *Testing*, Google expires the backend's access after 7 days, and syncing would silently stop every week. Once published, the access lasts until you revoke it.

Because the app isn't verified, sign-in shows a "Google hasn't verified this app" warning, and at most 100 people could ever use it. Neither matters here: you're the only one who signs in.

---

## 4 — Stop the local backend, then sign in to the cloud one

1. In the terminal running `npm run dev`, press **Ctrl+C**. **Don't run the local and cloud backends at the same time.** Both would sync the same calendar.
2. Open the sign-in page:
   ```bash
   open "$URL/auth/login"
   ```
3. On the warning screen, click **Advanced → Go to Calendar Grouper**. Leave the **Calendar** box checked, then click **Continue**. You should see "Authorization successful!"
   If you already granted access while running locally, there are no checkboxes. The screen says the app "already has some access". That's fine; click **Continue**.

This saves a fresh, non-expiring token in Firestore. Only `aryamanramchandran@gmail.com` is allowed to sign in (`ALLOWED_EMAILS`).

Signing in doesn't tell the extension who you are: the sign-in page doesn't hand your user ID back to the extension yet. An extension you already set up ([local setup](./setup.md), Phase 7) keeps working. A **fresh install** needs the Phase 7 step once, setting `userId` and `email` in the service worker console. Until then the popup shows the sign-in screen and loads no calendars.

---

## 5 — Schedule the 2-minute check
If this is a new Terminal window, re-run the 0c block, then read the tick secret back (it isn't printed):
```bash
TICK_SECRET=$(gcloud secrets versions access latest --secret=TICK_SECRET)
echo "secret length: ${#TICK_SECRET}"   # expect 64
```
```bash
gcloud scheduler jobs create http $SERVICE-tick --location $REGION \
  --schedule "*/2 * * * *" --uri "$URL/internal/tick" --http-method POST \
  --headers "x-tick-secret=$TICK_SECRET" --attempt-deadline 600s

# Run it once now and look at the result:
gcloud scheduler jobs run $SERVICE-tick --location $REGION
sleep 15
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE" \
  --limit 20 --freshness 10m --format='value(textPayload)'
```
When events changed, you'll see lines like `Auto-sync "My full schedule": 1 change(s) applied`, and failures show up as `Auto-sync failed for "<name>": …`. A check that finds nothing prints nothing, so to confirm the checks are running at all, look at the request log:
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE AND httpRequest.requestUrl:\"/internal/tick\"" \
  --limit 5 --freshness 1h --format='value(timestamp,httpRequest.status,httpRequest.latency)'
```
You want a **200** every 2 minutes. A **401** means the tick secret doesn't match. A 200 only means the check *ran*; it still returns 200 when a calendar's sync failed. So also make sure the application log above has no `Auto-sync failed` lines.

---

## 6 — Point the extension at the cloud

0. Rebuild the popup so it has the code that reads the URL and key from storage. An old build only knows `localhost` and shows "Failed to fetch":
   ```bash
   (cd extension/popup && npm run build)
   ```
1. `chrome://extensions` → Calendar Grouper → **service worker** → **Console**.
2. Paste this, with your URL and the API key from step 1:
   ```javascript
   chrome.storage.local.set(
     { backendUrl: "PASTE_URL_HERE", apiKey: "PASTE_API_KEY_HERE" },
     () => console.log("saved")
   );
   ```
   Print the URL with `echo $URL`. Use no trailing slash.
3. Click **↻** on the extension card, then open the popup. Your shared calendar and its settings should appear.

You don't need to rebuild the extension: it reads the URL and key from this storage.

---

## 7 — Test it with your laptop closed

1. Close the laptop lid, or shut it down.
2. On your phone, add an event to one of the calendars you share.
3. Within about 2 minutes it appears on the shared calendar, both for you and for the people you shared it with.

If she hasn't added the calendar yet: in the popup, enter her email under **Share with** → **Share**. She gets an email from Google Calendar and clicks **Add calendar**. That's everything she has to do.

---

## Everyday operations

**Deploying code changes:** your env vars and secrets persist, so only this is needed:
```bash
gcloud run deploy $SERVICE --source backend --region $REGION
```

**Logs:**
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE" \
  --limit 50 --freshness 1h --format='value(textPayload)'
```
Or Cloud console → Cloud Run → `calendar-grouper` → **Logs**.

**Working on the code locally again:**
1. Pause the cloud sync: `gcloud scheduler jobs pause $SERVICE-tick --location $REGION`
2. Point the extension back at your laptop: `chrome.storage.local.remove(["backendUrl", "apiKey"])` in the service worker console.
3. Start `npm run dev`.

When you're done, stop the local server, set `backendUrl`/`apiKey` again, and run `gcloud scheduler jobs resume $SERVICE-tick --location $REGION`.

**Changing how often it checks:** edit the schedule, for example every 5 minutes:
```bash
gcloud scheduler jobs update http $SERVICE-tick --location $REGION --schedule "*/5 * * * *"
```

**Rotating the API key:**
```bash
printf %s "$(openssl rand -hex 32)" | gcloud secrets versions add API_KEY --data-file=-
gcloud run services update $SERVICE --region $REGION --update-labels key-rotated=$(date +%s)  # new revision reads the new key
```
Then update `apiKey` in the extension.

**Shutting it all down:**
```bash
gcloud scheduler jobs delete $SERVICE-tick --location $REGION
gcloud run services delete $SERVICE --region $REGION
```
Delete the shared calendar from the popup first if you no longer want it.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Deploy fails with a permissions error during the build | Step 0e |
| Deploy succeeds but `/health` fails, and logs say `Cloud mode needs these environment variables` | A variable from step 2 was empty. `echo $CLIENT_ID $EXT_ID $URL` and redeploy |
| `redirect_uri_mismatch` at sign-in | Step 3.1: the URI must exactly match `$URL/auth/callback` |
| Popup: "The backend rejected the API key" | `apiKey` in step 6 doesn't match: `gcloud secrets versions access latest --secret=API_KEY` |
| Popup: "Can't reach the backend" | `backendUrl` typo (a trailing slash is fine; the popup strips it) |
| Popup: "Failed to fetch" | The popup is an old build that only knows `localhost`. Run `npm run build` in `extension/popup` and reload the extension (step 6.0) |
| `--region: expected one argument` / `No host part in the URL` | The step 0c variables aren't set in this Terminal window. Re-run the 0c block |
| "Invalid Origin: URIs must not contain a path" | The redirect URI is in *Authorized JavaScript origins*. Move it to *Authorized redirect URIs* (step 3.1) |
| Publish says homepage / privacy policy URL required | Step 3.2 (Branding + GitHub Pages) |
| Popup shows a CORS error in its console | `EXTENSION_ID` in step 2 doesn't match the ID on the extension card |
| Logs: `invalid_grant` | The sign-in token is gone or expired. Make sure the app is **In production** (step 3.2), then repeat step 4 |
| Events stop appearing | Logs for `Auto-sync failed`; Cloud Scheduler → `calendar-grouper-tick` → last run status |
| Duplicate events | The local and cloud backends both ran. Stop the local one; the Delete button plus Create rebuilds a clean copy |
