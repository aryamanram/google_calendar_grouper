# Publishing to the Chrome Web Store

One listing serves everyone: the extension works with any Calendar Grouper backend, and each person connects to theirs through an invite link. Publishing it doesn't make you pay for anyone else's backend.

## One-time setup

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), sign in with the Google account that should own the listing, and pay the one-time $5 registration fee.
2. Under **Account**, verify your contact email.

## Each release

1. Bump `version` in `extension/manifest.json`. The store rejects a version it has already seen.
2. Build the zip:
   ```bash
   ./scripts/package-extension.sh
   ```
   It prints the path, e.g. `dist/calendar-grouper-1.0.0.zip`. (GitHub releases also get this zip automatically.)
3. Dashboard → **New item** (first time) or the item → **Package → Upload new package**, and choose the zip.
4. Fill in or check the tabs below, then **Submit for review**. Reviews usually take a few days.

## Store listing

**Name:** Calendar Grouper

**Summary** (132 characters max):
> Share your Google Calendars as one calendar someone can toggle on and off, without merging them.

**Description:**
> Keep your Google Calendars organized by topic (Work, School, Family, Workout) and share all of them as one calendar.
>
> Calendar Grouper creates one extra calendar in your Google account and keeps it filled with copies of the events from the calendars you pick. Share that one calendar with a partner, family or friends: they add it like any other Google Calendar and can toggle it on and off. They don't need the extension.
>
> • Choose which calendars to include
> • Share each one with full details, or as "busy" only
> • New, edited and deleted events sync within about two minutes, even when your computer is off
> • Your own calendars are never changed
>
> Calendar Grouper is open source and self-hosted: it runs on a small backend in the owner's own Google Cloud project, within the free tier. Whoever runs a backend invites people from the extension, and they join with an invite link and one Google sign-in.
>
> Set up your own backend, or read how it works: https://calendargrouper.com

**Category:** Productivity → Tools (or Workflow & Planning)

**Language:** English

**Graphics:**
- Icon: `extension/assets/icon128.png`
- At least one screenshot, 1280×800 or 640×400: the popup next to Google Calendar showing the shared calendar
- Small promo tile (440×280), optional: can be made from `site/public/og.png`

## Privacy tab

**Single purpose:**
> Combine the Google Calendars a user selects into one shared Google Calendar and keep it in sync.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `identity` | Runs Google sign-in (`chrome.identity.launchWebAuthFlow`) through the user's Calendar Grouper backend, which then syncs their calendars. |
| `storage` | Remembers which backend the user connected to, their session token, and their email. |
| Content script on `https://calendargrouper.com/join*` | Reads an invite link the user opened on that page, to connect the extension to the backend the link names. It runs on no other site. |

**Remote code:** No. All code is in the package.

**Data usage:** the extension handles personally identifiable information (email address) and authentication information (session token). Tick the three certifications: not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending.

**Privacy policy URL:** `https://calendargrouper.com/privacy`

## Distribution

- **Visibility:** *Unlisted* works with a direct link only; *Public* also appears in search. Either works for invites.
- **Regions:** all.

## After it's approved

1. Put the store link in `site/guide/install.md` (replace "on its way") and in the join page's install step (`site/join.md`).
2. Optional: so copies loaded from GitHub get the same ID as the store version, copy the item's **public key** (Dashboard → item → **Package → View public key**) into `manifest.json` as `"key"`. With the default backend settings the ID doesn't matter. It does if a backend sets `EXTENSION_ID`: then only the listed IDs can sign in, so either add this key first (every copy then shares the store's ID) or add each GitHub-loaded copy's ID to `EXTENSION_ID`.
