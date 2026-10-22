# FAQ

## Does the other person need the extension?

No. They add the shared calendar like any other Google Calendar, from the email Google sends when you share it. Only someone who wants to share their own calendars needs the extension.

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

To run your own copy: nothing, in practice. Checking every two minutes, usage for a handful of people stays inside Google Cloud's free tier for Cloud Run, Cloud Scheduler and Firestore. Each extra person adds a little Firestore and Cloud Run usage, so keep the budget alert on as you add people. Google requires a billing account with a card on file to turn these services on, and the setup guide has you add a $1 budget alert.

## How do I remove it completely?

1. Delete the shared calendar from the popup.
2. Revoke access at [myaccount.google.com/connections](https://myaccount.google.com/connections).
3. Remove the extension from Chrome.

To also delete your stored sign-in tokens, see the [privacy policy](/privacy#keeping-and-deleting-your-data).

## Why does Google say the app isn't verified?

Each copy of Calendar Grouper signs in through its owner's own Google Cloud project, and Google only removes the warning after reviewing an app for public use. A personal copy doesn't need that review, so sign-in shows "Google hasn't verified this app". Click **Advanced**, then **Go to Calendar Grouper**.

## Can I sign up without setting anything up?

No. There's no public Calendar Grouper service. To use it, someone who [runs their own copy](/self-hosting/setup) invites you, or you run one yourself and invite whoever you like.

## Is the invite link a password?

No. It only tells your extension where the backend is. What lets you in is your Google account being on the backend's list, which the person who invited you controls.

## Can two people share their schedules with each other?

Yes. Each person creates their own shared calendar and shares it with the other. Both can use the same backend: the person who runs it [invites](./using#invite-people) the other. Each person picks and controls only their own source calendars and settings; what the other person sees is the shared calendar you chose to share with them.
