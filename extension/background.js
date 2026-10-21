// ---------------------------------------------------------------------------
// Background service worker for Calendar Grouper
//
// Keeps the extension's settings in chrome.storage.local and runs Google
// sign-in. Stored keys:
//   backendUrl  the Calendar Grouper backend, e.g. https://…run.app
//   apiKey      the backend's API_KEY (not needed for a local backend)
//   userId      the signed-in Google account's ID
//   email       the signed-in Google account's email
//   authError   why the last sign-in failed, shown by the popup
// ---------------------------------------------------------------------------

const DEFAULT_BACKEND_URL = "http://localhost:3000";
const SETTINGS_KEYS = ["userId", "email", "backendUrl", "apiKey", "authError"];

function trimUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

// Sign in through the backend's Google consent flow. Chrome shows it in its
// own window and gives back the final https://<id>.chromiumapp.org/ address,
// which carries the account in its fragment (see backend/src/routes/auth.js).
// Runs here rather than in the popup, because the popup closes as soon as the
// sign-in window takes focus.
async function signIn() {
  const { backendUrl } = await chrome.storage.local.get("backendUrl");
  const base = trimUrl(backendUrl) || DEFAULT_BACKEND_URL;
  const url = `${base}/auth/login?ext=${encodeURIComponent(chrome.runtime.id)}`;

  await chrome.storage.local.remove("authError");
  try {
    const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    const params = new URLSearchParams(new URL(redirect).hash.slice(1));
    const userId = params.get("userId");
    if (!userId) throw new Error("Sign-in didn't return an account.");
    await chrome.storage.local.set({ userId, email: params.get("email") || null });
    return { ok: true };
  } catch (err) {
    // When the backend refuses the account or this extension's ID, the flow
    // ends on an error page instead of a redirect, and the user closes the
    // window. Chrome reports that exactly like cancelling, so one message
    // covers both.
    const message =
      "Sign-in didn't finish. If you closed the window on purpose, try again. Otherwise check that this Google account and this extension's ID are allowed on the backend.";
    console.warn("Sign-in failed:", err.message);
    await chrome.storage.local.set({ authError: message });
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_AUTH_STATE") {
    chrome.storage.local.get(SETTINGS_KEYS).then(
      (data) =>
        sendResponse({
          userId: data.userId || null,
          email: data.email || null,
          backendUrl: data.backendUrl || null, // null: not set up yet
          apiKey: data.apiKey || null,
          authError: data.authError || null,
        }),
      (err) => sendResponse({ error: err.message })
    );
    return true; // async sendResponse
  }

  if (message.type === "SAVE_SETTINGS") {
    (async () => {
      const backendUrl = trimUrl(message.backendUrl);
      const { backendUrl: previous } = await chrome.storage.local.get("backendUrl");
      // A different backend doesn't know this account, so sign in again there.
      const backendChanged = trimUrl(previous) !== backendUrl;
      if (backendChanged) await chrome.storage.local.remove(["userId", "email", "authError"]);
      await chrome.storage.local.set({ backendUrl, apiKey: message.apiKey?.trim() || null });
      sendResponse({ saved: true, backendChanged });
    })();
    return true;
  }

  if (message.type === "START_AUTH") {
    signIn().then(sendResponse);
    return true;
  }

  if (message.type === "LOGOUT") {
    chrome.storage.local.remove(["userId", "email", "authError"]).then(() => sendResponse({ cleared: true }));
    return true;
  }
});
