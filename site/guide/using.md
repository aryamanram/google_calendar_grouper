# Using Calendar Grouper

Everything happens in the extension's popup. Click the Calendar Grouper icon in Chrome's toolbar to open it.

## Get started

1. [Install the extension](./install).
2. **Open your invite link** in Chrome. The person who runs your backend sends it to you, and the extension connects by itself. (Running your own backend? Paste its address on the popup's **Connect** screen instead.)
3. Click the Calendar Grouper icon, then **Sign in with Google**, and approve access in the window that opens. If Google warns that the app isn't verified, click **Advanced**, then **Go to Calendar Grouper**.

Your email appears at the bottom of the popup, with **Settings** to connect to a different backend and **Sign out**.

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

## Invite people

If you run the backend (you're an owner), the popup shows **People with access**. Click **Manage**:

1. Enter someone's Google account email and click **Add**.
2. Click **Copy invite link** and send it to them.

They sign in with their own Google account and build their own shared calendar. The extension never shows one person's calendars to another; you each see only what the other shares with you through Google Calendar. Your backend does hold everyone's Google sign-in, though, so only invite people who trust you to run it, and only join a backend run by someone you trust. To remove someone, click **✕**: they're signed out at once, and their shared calendar stops updating.

## Delete the shared calendar

Click **Delete shared calendar**, then **Click again to delete** to confirm. This deletes the shared calendar from Google, so everyone you shared it with loses it, and removes Calendar Grouper's stored settings for it. Your own calendars aren't touched.
