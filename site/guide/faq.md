# FAQ

## Does the other person need the extension?

No. They add the shared calendar like any other Google Calendar, from the email Google sends when you share it. Only the person creating the shared calendar uses the extension.

## How quickly do changes show up?

Within about two minutes. Click **Sync now** in the popup to sync immediately.

## Why aren't Tasks or Birthdays in the list?

They appear in Google Calendar's sidebar, but they aren't regular calendars that Google lets apps read through the Calendar API. Tasks belong to Google Tasks, which is a separate product.

## How far back does it copy?

Events from 30 days ago onward, including everything in the future. Repeating events that started earlier are included as long as they continue into that window.

## Will it change my own calendars?

No. Calendar Grouper only reads the calendars you select. The only calendar it writes to is the shared one it created.

## What does "busy only" share?

Only the start and end time, shown as "Busy". The title, description, location and guest list aren't copied.

## What if I edit an event on the shared calendar directly?

The next change to the original overwrites it. If you delete a copy by hand, it's recreated the next time the original changes. Make changes on your own calendars, not on the shared one.

## What does it cost?

To run your own copy: nothing, in practice. With one shared calendar checked every two minutes, usage stays inside Google Cloud's free tier for Cloud Run, Cloud Scheduler and Firestore. Google requires a billing account with a card on file to turn these services on, and the setup guide has you add a $1 budget alert.

## How do I remove it completely?

1. Delete the shared calendar from the popup.
2. Revoke access at [myaccount.google.com/connections](https://myaccount.google.com/connections).
3. Remove the extension from Chrome.

To also delete your stored sign-in tokens, see the [privacy policy](/privacy#keeping-and-deleting-your-data).

## Why does Google say the app isn't verified?

Google verifies apps that ask for calendar access before it removes that warning. Verification is in progress. Until then, sign-in shows "Google hasn't verified this app". Click **Advanced**, then **Go to Calendar Grouper**.
