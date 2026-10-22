# Install the extension

Calendar Grouper works in Google Chrome on a computer, and in other Chromium browsers such as Edge and Brave.

## From the Chrome Web Store

The Chrome Web Store listing is on its way. Until it's live, install it from GitHub as below.

## From a zip

1. Get the zip, `calendar-grouper-<version>.zip`:
   - from the [releases page](https://github.com/aryamanram/google_calendar_grouper/releases), once a release is published, or
   - from the person who invited you: they can make it with `./scripts/package-extension.sh` in their copy of the code.

   Unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder (the one containing `manifest.json`).
4. Click the puzzle-piece icon in the toolbar and pin **Calendar Grouper**, so it's one click away.

An extension installed this way doesn't update itself. To update, download the new zip, replace the folder's contents, and click **↻** on the extension's card.

## Next

Open your invite link, then sign in. See [Using Calendar Grouper](./using#get-started).
