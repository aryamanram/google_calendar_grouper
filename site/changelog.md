# Changelog

## 1.0.0 (unreleased)

The first release.

### Features

- Combine any of your Google Calendars into one shared calendar, with a name you choose
- Per-calendar detail level: full details or busy only
- Share the shared calendar by email from the extension
- Automatic sync every two minutes: new, edited and deleted events, including single occurrences of repeating events
- **Sync now**, **Retry** and sync status in the popup
- Invite people from the extension: add their email, send them a link, and they're in after one Google sign-in
- Several people can use one backend, each with their own calendars, and owners can remove access at any time
- Packaged for the Chrome Web Store, with a zip on every GitHub release
- Runs on Google Cloud Run with Cloud Scheduler, within the free tier, so syncing continues with your computer off

### Reliability and security

- One sync at a time per shared calendar, enforced with a lease in Firestore that also works across server instances
- Safe retries that never create duplicate events
- A separate session for each person's extension, so nobody can act as someone else; only token hashes are stored
- A secret for the scheduler, and sign-in limited to owners and invited people
- Secrets kept in Google Secret Manager
