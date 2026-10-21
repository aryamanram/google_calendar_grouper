# How it works

Calendar Grouper has three parts.

| Part | Runs on | Job |
|---|---|---|
| **Chrome extension** | Your browser | The control panel: pick calendars, set detail levels, share |
| **Backend** | Google Cloud Run | Reads your selected calendars and keeps the shared calendar in sync |
| **Database** | Google Cloud Firestore | Remembers your settings and which copy belongs to which original event |

A **Cloud Scheduler** job wakes the backend every two minutes. Between checks nothing runs, which is why it fits in Google Cloud's free tier.

## Syncing

On the first sync, the backend reads every event from the last 30 days onward on each selected calendar and copies it into the shared calendar. It records each pair (*original event → copy*) along with when the original was last modified.

After that, each check uses a Google Calendar **sync token**. That asks Google only for what changed since the last check. A check with no changes is a single small request per calendar and writes nothing.

For each change:

- **New event:** a copy is created.
- **Edited event:** the copy is updated. Events that haven't really changed are skipped.
- **Deleted event:** the copy is deleted.
- **One occurrence of a repeating event changed or cancelled:** that occurrence of the copied series is updated or cancelled, rather than a duplicate being added.

Busy-only calendars copy only the start and end time, titled "Busy".

## Staying correct

- **One sync at a time.** Each shared calendar has a lock, so a scheduled check, a *Sync now* and an *Update* never write to it at the same moment. The lock lives in Firestore with an expiry, so it also works when Cloud Run briefly runs two copies of the backend, for example during a deploy. A sync that loses its lock stops writing at once.
- **Retries.** When Google rate-limits a request, the backend waits and tries again. It never retries in a way that could create a duplicate.
- **Your own calendars are read-only.** The only calendar Calendar Grouper writes to is the one it created. It's tagged, so it's never offered as a source.

## Security

- Every request from the extension carries an API key. The scheduled check carries its own separate secret.
- Only the Google accounts you list are allowed to sign in.
- Secrets (the OAuth client secret, the API key and the scheduler secret) live in Google Secret Manager, never in the code or the container.
- See the [privacy policy](/privacy) for exactly what's stored.

## Source

The code is on [GitHub](https://github.com/aryamanram/google_calendar_grouper): the extension is in `extension/`, and the backend is in `backend/`.
