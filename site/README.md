# Website

The Calendar Grouper website and documentation, built with [VitePress](https://vitepress.dev). Every page is a Markdown file in this folder, so editing a page here updates the website.

| Path | Page |
|---|---|
| `index.md` | Home page |
| `guide/` | User guide |
| `self-hosting/` | Setup and deploy guides |
| `privacy.md`, `terms.md` | Privacy policy and terms (linked from Google's OAuth consent screen) |
| `changelog.md` | Release notes |
| `public/` | Images served as-is (`logo.png`, `hero.svg`, `og.png` for link previews) |
| `.vitepress/config.mts` | Navigation, sidebar, footer, metadata |
| `.vitepress/theme/` | Colors and fonts |

## Work on it locally

```bash
cd site
npm install
npm run dev      # http://localhost:5173, reloads as you edit
npm run build    # production build into .vitepress/dist; fails on broken links
```

## Publishing

`.github/workflows/site.yml` builds the site on every pull request that changes it, and deploys it to Firebase Hosting when the change is merged into `main`. It signs in to Google Cloud with Workload Identity Federation, so no key file is stored in GitHub.

### One-time setup

Run these once, in a terminal signed in to `gcloud` as the project owner.

**1. Add Firebase to the Google Cloud project.** Go to [console.firebase.google.com](https://console.firebase.google.com) → **Create a project** → **Add Firebase to Google Cloud project** (link at the bottom), choose `calendar-grouper-511703`, and turn off Google Analytics. Then open **Hosting** → **Get started** and click through; the CLI steps it shows can be skipped.

**2. Create a deploy identity for GitHub.**

```bash
PROJECT_ID=calendar-grouper-511703
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
REPO=aryamanram/google_calendar_grouper
SA=site-deployer@$PROJECT_ID.iam.gserviceaccount.com

gcloud services enable firebasehosting.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com --project $PROJECT_ID

gcloud iam service-accounts create site-deployer --project $PROJECT_ID \
  --display-name "Website deployer (GitHub Actions)"

for ROLE in roles/firebasehosting.admin roles/firebase.viewer roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member "serviceAccount:$SA" \
    --role $ROLE --condition None >/dev/null
done

gcloud iam workload-identity-pools create github --project $PROJECT_ID \
  --location global --display-name "GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github --project $PROJECT_ID \
  --location global --workload-identity-pool github --display-name "GitHub" \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"

gcloud iam service-accounts add-iam-policy-binding $SA --project $PROJECT_ID \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

echo "GCP_WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github"
echo "GCP_DEPLOY_SA=$SA"
```

The provider only accepts tokens from this repository's `main` branch, so a fork or another branch can't deploy.

**3. Add repository variables.** On GitHub: **Settings** → **Secrets and variables** → **Actions** → **Variables** tab → **New repository variable**. None of these are secret.

| Name | Value |
|---|---|
| `GCP_PROJECT_ID` | `calendar-grouper-511703` |
| `GCP_WIF_PROVIDER` | printed by the last command above |
| `GCP_DEPLOY_SA` | printed by the last command above |
| `SITE_URL` | the site's address, e.g. `https://calendar-grouper-511703.web.app`; change it to the custom domain once that's connected |

**4. Deploy.** **Actions** tab → **Website** → **Run workflow**. After that, every merge into `main` that changes `site/` deploys on its own.

### Custom domain

Firebase console → **Hosting** → **Add custom domain**. Firebase shows DNS records to add at your registrar and issues the HTTPS certificate itself, which can take up to 24 hours. Then update the `SITE_URL` variable.
