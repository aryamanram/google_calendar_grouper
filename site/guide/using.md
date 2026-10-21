# Using Calendar Grouper

Everything happens in the extension's popup. Click the Calendar Grouper icon in Chrome's toolbar to open it.

## Create your shared calendar

1. **Name it.** Under *Shared calendar name*, type what the other person will see, for example *Alex's schedule*. The default is *My full schedule*.
2. **Pick calendars.** Under *My calendars*, tick each calendar to include. Unticked calendars are never read.
3. **Set the detail level.** Click the dot next to a calendar to switch between:
   - <span class="cal-dot full"></span>**Full details**: titles, times, locations and descriptions are copied.
   - <span class="cal-dot busy"></span>**Busy only**: only the time is copied, shown as "Busy". A small *busy* badge marks these calendars.
4. Click **Create**.

The button changes to *Creating…*, then *Syncing…*, while existing events are copied. That usually takes under a minute. You can close the popup while it runs. Events from the last 30 days onward are included.

::: tip Hide it on your side
The shared calendar also appears in your own Google Calendar sidebar, so you'd see every event twice. Untick it there. It's meant for the people you share it with.
:::

## Share it

Under **Share with**, enter an email address and click **Share**. The person gets an email from Google Calendar and clicks **Add calendar**. That's all they need to do: no extension, no account setup.

To stop sharing with someone, click **✕** next to their address.

## Keep it up to date

You don't have to do anything. Calendar Grouper checks your calendars every two minutes and copies:

- new events
- edits, including to a single occurrence of a repeating event
- deletions

The status line at the bottom shows when it last checked. Click **Sync now** if you don't want to wait.

## Change what's included

Tick or untick calendars, switch detail levels, or rename the shared calendar, then click **Update**:

- **Unticked calendars:** their events are removed from the shared calendar.
- **Newly ticked calendars:** their events are copied in.
- **A changed detail level:** that calendar's events are rebuilt with the new level.

## If something goes wrong

If a sync fails, the status line turns red and says *Last sync failed*. Hover over it to see the reason, and click **Retry**. Automatic checks also keep retrying in the background.

## Delete the shared calendar

Click **Delete shared calendar**, then **Click again to delete** to confirm. This deletes the shared calendar from Google, so everyone you shared it with loses it, and removes Calendar Grouper's stored settings for it. Your own calendars aren't touched.
