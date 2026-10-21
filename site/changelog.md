# Changelog

## 1.0.0 (unreleased)

The first release.

### Features

- Combine any of your Google Calendars into one shared calendar, with a name you choose
- Per-calendar detail level: full details or busy only
- Share the shared calendar by email from the extension
- Automatic sync every two minutes: new, edited and deleted events, including single occurrences of repeating events
- **Sync now**, **Retry** and sync status in the popup
- Runs on Google Cloud Run with Cloud Scheduler, within the free tier, so syncing continues with your computer off

### Reliability and security

- One sync at a time per shared calendar, enforced with a lease in Firestore that also works across server instances
- Safe retries that never create duplicate events
- API key on extension requests, a separate secret for the scheduler, and an allow-list of Google accounts
- Secrets kept in Google Secret Manager
