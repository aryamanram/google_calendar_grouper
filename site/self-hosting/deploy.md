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

Two secrets go in **Secret Manager**, never in code or in the image:

| Secret | What it is |
|---|---|
| `GOOGLE_CLIENT_SECRET` | Your OAuth client secret (already in `backend/.env`) |
| `TICK_SECRET` | A new random key Cloud Scheduler sends, so only it can trigger syncs |

People don't need a key: each person signs in with Google, and the backend gives their extension its own session.

```bash
TICK_SECRET=$(openssl rand -hex 32)

printf %s "$TICK_SECRET" | gcloud secrets create TICK_SECRET --data-file=-
grep '^GOOGLE_CLIENT_SECRET=' backend/.env | cut -d= -f2- | tr -d '\n' \
  | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-

for s in TICK_SECRET GOOGLE_CLIENT_SECRET; do
  gcloud secrets add-iam-policy-binding $s \
    --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
```

The backend runs as the `calendar-grouper-backend` service account you made in Phase 3. It already has Firestore access, and the loop above lets it read these two secrets. The JSON key file stays on your laptop; Cloud Run doesn't use it.

---

## 2 — Deploy the backend
```bash
CLIENT_ID=$(grep '^GOOGLE_CLIENT_ID=' backend/.env | cut -d= -f2-)

gcloud run deploy $SERVICE --source backend --region $REGION \
  --service-account $SA --allow-unauthenticated \
  --min-instances 0 --max-instances 1 --cpu 1 --memory 512Mi --timeout 900 \
  --set-env-vars "RUN_MODE=cloud,FIRESTORE_PROJECT_ID=$PROJECT_ID,GOOGLE_CLIENT_ID=$CLIENT_ID,GOOGLE_REDIRECT_URI=$URL/auth/callback,BACKEND_URL=$URL,ALLOWED_EMAILS=you@gmail.com" \
  --set-secrets "GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,TICK_SECRET=TICK_SECRET:latest"
```
- Replace `you@gmail.com` with your Google account. `ALLOWED_EMAILS` lists the backend's **owners**: they can sign in and invite other people from the extension (see [Inviting people](#inviting-people)). To have two owners, separate the emails with a space.
- If it asks to create an Artifact Registry repository, answer **Y**.
- The first build takes 2–4 minutes.

What the flags mean:
- `--allow-unauthenticated`: the extension and Google's sign-in page must be able to reach the backend. What keeps it private: only owners and people they invite can sign in, every request needs that person's session, and syncs need the tick secret.
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
2. **Branding**: publishing needs a homepage and a privacy policy link. If you don't have your own, use the project's:
   - **Application home page:** `https://calendargrouper.com`
   - **Application privacy policy link:** `https://calendargrouper.com/privacy`
   - **Authorized domains:** `calendargrouper.com`
   - Skip the logo. Uploading one forces a verification review.
3. **Audience** → **Publish app** → **Confirm**. Status changes to **In production**. A "needs verification" notice appears; leave it, since it's not required at this size.

Why publish: while the app is in *Testing*, Google expires the backend's access after 7 days, and syncing would silently stop every week. Once published, the access lasts until you revoke it.

Because the app isn't verified, sign-in shows a "Google hasn't verified this app" warning, and at most 100 people could ever use it. Neither matters for a personal backend: only the accounts in `ALLOWED_EMAILS` can sign in, and you don't need to submit it for verification.

---

## 4 — Stop the local backend, then sign in to the cloud one

1. In the terminal running `npm run dev`, press **Ctrl+C**. **Don't run the local and cloud backends at the same time.** Both would sync the same calendar.
2. Open the sign-in page:
   ```bash
   open "$URL/auth/login"
   ```
3. On the warning screen, click **Advanced → Go to Calendar Grouper**. Leave the **Calendar** box checked, then click **Continue**. You should see "Authorization successful!"
   If you already granted access while running locally, there are no checkboxes. The screen says the app "already has some access". That's fine; click **Continue**.

This saves a fresh, non-expiring token in Firestore. Only the accounts in `ALLOWED_EMAILS` are allowed to sign in. (You'll also sign in from the extension in step 6; this step just confirms sign-in works on the cloud backend.)

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

1. Rebuild the popup and reload the extension, so it has the latest code:
   ```bash
   (cd extension/popup && npm run build)
   ```
   Then click **↻** on the extension's card in `chrome://extensions`.
2. Open the popup. On the **Connect** screen (or **Settings** at the bottom), paste the output of `echo $URL` and click **Connect**.
3. Click **Sign in with Google**. Your shared calendar and its settings appear.

---

## 7 — Test it with your laptop closed

1. Close the laptop lid, or shut it down.
2. On your phone, add an event to one of the calendars you share.
3. Within about 2 minutes it appears on the shared calendar, both for you and for the people you shared it with.

If someone hasn't added your shared calendar yet: in the popup, enter their email under **Share with** → **Share**. They get an email from Google Calendar and click **Add calendar**. That's everything they have to do.

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
2. Point the extension at your laptop: popup → **Settings** → paste `http://localhost:3000` → **Connect**, then sign in.
3. Start `npm run dev`.

When you're done, stop the local server, connect the extension to `$URL` again, and run `gcloud scheduler jobs resume $SERVICE-tick --location $REGION`.

**Changing how often it checks:** edit the schedule, for example every 5 minutes:
```bash
gcloud scheduler jobs update http $SERVICE-tick --location $REGION --schedule "*/5 * * * *"
```

**Upgrading a backend deployed before invites (October 2026):** the extension no longer uses an API key or a fixed extension ID. Remove both from the service, then sign in again from the popup:
```bash
gcloud run services update $SERVICE --region $REGION --remove-env-vars EXTENSION_ID --remove-secrets API_KEY
```

**Signing everyone out:** delete the `sessions` collection in Firestore Studio. Everyone signs in again the next time they open the popup.

### Inviting people

Friends, a partner or family can use your backend for their own calendars. Their calendars and settings stay separate from yours, and you pay for the backend; each extra person adds very little.

1. In the popup, open **People with access → Manage**, enter their Google account's email, and click **Add**.
2. Click **Copy invite link** and send it to them. The link only tells their extension where your backend is; it isn't a password. Only the people you added can sign in.
3. They install the extension ([Install](/guide/install)), open the link in Chrome, and click **Sign in with Google**. They'll see Google's "unverified app" warning: **Advanced → Go to Calendar Grouper**.

To remove someone, click **✕** next to them. They're signed out at once, and their shared calendar stops updating (it stays in their Google account until they delete it).

Google caps an unverified app at 100 people. `ALLOWED_EMAILS` owners can't be removed from the popup; change the variable instead.

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
| Deploy succeeds but `/health` fails, and logs say `Cloud mode needs these environment variables` | A variable from step 2 was empty. `echo $CLIENT_ID $URL` and redeploy |
| `redirect_uri_mismatch` at sign-in | Step 3.1: the URI must exactly match `$URL/auth/callback` |
| Popup: "Can't reach …" when connecting | The address is wrong, or the backend is down: `curl $URL/health` |
| Popup: "Sign-in didn't finish" | The window was closed, or the account isn't an owner or invited. The backend log says `Sign-in refused for …` for a refused account |
| Popup: "You were signed out" | The session was ended (signed out, or removed and re-added). Sign in again |
| Popup has no **Settings** link, or shows a blue "G" icon | It's an old build. Run `npm run build` in `extension/popup` and reload the extension (step 6.1) |
| `--region: expected one argument` / `No host part in the URL` | The step 0c variables aren't set in this Terminal window. Re-run the 0c block |
| "Invalid Origin: URIs must not contain a path" | The redirect URI is in *Authorized JavaScript origins*. Move it to *Authorized redirect URIs* (step 3.1) |
| Publish says homepage / privacy policy URL required | Step 3.2 (Branding) |
| Popup shows a CORS error in its console | `EXTENSION_ID` is set on the backend and doesn't include this copy's ID. Remove the variable unless you need it |
| Logs: `invalid_grant` | The sign-in token is gone or expired. Make sure the app is **In production** (step 3.2), then repeat step 4 |
| Events stop appearing | Logs for `Auto-sync failed`; Cloud Scheduler → `calendar-grouper-tick` → last run status |
| Duplicate events | The local and cloud backends both ran. Stop the local one; the Delete button plus Create rebuilds a clean copy |
