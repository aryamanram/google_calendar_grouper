---
title: Privacy policy
aside: false
editLink: false
lastUpdated: false
---

# Privacy policy

*Effective October 21, 2026*

Calendar Grouper is open-source software by Aryaman Ramchandran. It combines Google Calendars you choose into one shared calendar. This policy explains what it accesses, what it stores, and how to remove it.

There's no public Calendar Grouper service. Each copy runs on a backend in its operator's own Google Cloud project, and only the Google accounts that operator allows can sign in. The developer's own backend is private. "The operator" below means whoever runs the backend you use.

## What Calendar Grouper accesses

When you sign in with Google, you grant two permissions:

- **Google Calendar** (`calendar`): used to list your calendars, read events from the calendars you select, create the one shared calendar, copy events into it and keep them in sync, and manage who that shared calendar is shared with. Calendar Grouper never changes or deletes events on your own calendars.
- **Your email address** (`userinfo.email`): used to identify your account and to check that it's allowed to sign in.

## What is stored

Calendar Grouper keeps a small amount of data in a Google Cloud Firestore database run by the operator:

| Data | Why |
|---|---|
| Google sign-in tokens | To sync your calendars while you're away |
| Your Google account ID and email | To link your settings to your account, and to check you still have access |
| A hash of each extension session token | To recognize your extension's requests. The token itself isn't stored |
| The emails of people an owner invited, and who invited them | To decide who may sign in |
| Shared calendar settings: its name, the IDs and names of the calendars you selected, each calendar's detail level, and the email addresses you share it with | To remember your choices |
| Event ID pairs (an original event's ID and its copy's ID) with a last-modified timestamp | To update and remove copies correctly, and to skip events that haven't changed |
| Sync status: progress markers, the last sync time and any error message | To sync only what changed, and to show sync status |

**Event contents aren't stored by Calendar Grouper.** Titles, descriptions and locations are read from your selected calendars and written straight into the shared calendar, which lives in your own Google account. They never go into Calendar Grouper's database. For calendars set to "busy", only the times are copied.

The extension also keeps a few settings in your browser (`chrome.storage.local`): the backend address, your session token, and the signed-in account's ID and email. **Sign out** removes the token, ID and email, and ends the session on the backend; removing the extension deletes all of it. The extension reads web pages only on `calendargrouper.com/join`, to pick up an invite link you opened.

Server logs record calendar names, event counts and errors, and are kept under Google Cloud's default log retention. They don't contain event contents.

## This website

This website uses no cookies, analytics or tracking. It's served by Firebase Hosting, which processes your IP address and browser details to deliver the pages.

## Sharing

The shared calendar's events are visible to the people you choose to share it with, through Google Calendar's normal sharing. Calendar Grouper doesn't sell, rent or share your data with anyone. It shows no ads and includes no analytics or tracking. It runs on Google Cloud (Cloud Run, Firestore, Secret Manager), which processes this data on the operator's behalf.

## Google API Services User Data Policy

Calendar Grouper's use and transfer of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Data from Google APIs is used only to provide the features described here, isn't used for advertising, and isn't read by people except when needed for security, to comply with the law, or with your permission.

## Keeping and deleting your data

- **Delete the shared calendar** from the extension. This removes the calendar from Google and deletes its settings and event ID pairs from Calendar Grouper's database.
- **Revoke access** at any time at [myaccount.google.com/connections](https://myaccount.google.com/connections). Calendar Grouper then can no longer reach your calendars.
- **Remove everything**, including your stored sign-in tokens, by asking the operator. For the developer's own backend, email the address below; it's deleted within 30 days.

## Self-hosted copies

If you run your own copy by following the [self-hosting guide](/self-hosting/setup), you're the operator: your data is stored in your own Google Cloud project, and the developer has no access to it.

## Children

Calendar Grouper isn't directed at children under 13 and doesn't knowingly collect their data.

## Changes

If this policy changes, the updated version will be posted on this page with a new effective date.

## Contact

Questions or deletion requests: [aryamanramchandran@gmail.com](mailto:aryamanramchandran@gmail.com)
