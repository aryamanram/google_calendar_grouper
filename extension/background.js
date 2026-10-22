// ---------------------------------------------------------------------------
// Background service worker for Calendar Grouper
//
// Keeps the extension's state in chrome.storage.local and does the work the
// popup can't (the popup closes whenever it loses focus):
//   backendUrl  the Calendar Grouper backend this copy is connected to
//   token       this person's session token on that backend
//   userId      the signed-in Google account's ID
//   email       the signed-in Google account's email
//   authError   why the last sign-in failed, shown by the popup
//   pendingInvite  a backend an invite page asked to switch to; the popup
//                  asks before switching (see JOIN below)
//
// Connecting: an invite link (https://calendargrouper.com/join#backend=…)
// carries the backend's address. Opening it runs join.js on that page, which
// hands the address here. People can also paste the link into the popup.
// ---------------------------------------------------------------------------

const IDENTITY_KEYS = ["token", "userId", "email", "authError"];

function trimUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

// Accepts an invite link or a bare backend address. Returns the address, or
// null if the text is neither.
function backendFromInvite(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const fromFragment = new URLSearchParams(url.hash.slice(1)).get("backend");
  const candidate = fromFragment || (url.pathname.startsWith("/join") ? null : raw);
  if (!candidate) return null;
  try {
    const backend = new URL(candidate);
    const local = backend.hostname === "localhost" || backend.hostname === "127.0.0.1";
    if (backend.protocol !== "https:" && !(local && backend.protocol === "http:")) return null;
    return trimUrl(backend.origin + backend.pathname);
  } catch {
    return null;
  }
}

// Check that an address really answers like a Calendar Grouper backend.
// (Anyone can fake this; it catches typos and dead links, not attackers.)
async function checkBackend(backendUrl) {
  let health;
  try {
    const res = await fetch(`${backendUrl}/health`);
    health = await res.json();
  } catch {
    return { ok: false, error: `Can't reach ${backendUrl}. Check the link, or ask the person who sent it.` };
  }
  if (health?.status !== "ok" || health?.app !== "calendar-grouper") {
    return { ok: false, error: `${backendUrl} isn't a Calendar Grouper backend.` };
  }
  return { ok: true };
}

// Connect to a backend after checking it.
async function connect(text) {
  const backendUrl = backendFromInvite(text);
  if (!backendUrl) {
    return { ok: false, error: "That doesn't look like an invite link or a backend address." };
  }
  const check = await checkBackend(backendUrl);
  if (!check.ok) return check;

  await chrome.storage.local.remove("pendingInvite");
  const { backendUrl: previous } = await chrome.storage.local.get("backendUrl");
  // A different backend doesn't know this account, so sign in again there.
  const backendChanged = trimUrl(previous) !== backendUrl;
  if (backendChanged) await chrome.storage.local.remove(IDENTITY_KEYS);
  await chrome.storage.local.set({ backendUrl });
  return { ok: true, backendUrl, backendChanged };
}

// An invite page opened in the browser. Anyone can make such a link, so it
// connects straight away only when this copy isn't connected yet (or is
// already connected to that backend). Switching away from a backend signs
// the person out there, so that waits for a click in the popup.
async function join(url) {
  const backendUrl = backendFromInvite(url);
  if (!backendUrl) return { ok: false, error: "This invite link is incomplete. Ask for a new one." };

  const { backendUrl: current } = await chrome.storage.local.get("backendUrl");
  if (!current || trimUrl(current) === backendUrl) return connect(backendUrl);

  const check = await checkBackend(backendUrl);
  if (!check.ok) return check;
  await chrome.storage.local.set({ pendingInvite: backendUrl });
  return { ok: false, pending: true, backendUrl };
}

// Open the popup so the next step is right there. Chrome only allows this in
// some situations; the invite page also tells people to click the icon.
async function tryOpenPopup() {
  try {
    await chrome.action.openPopup?.();
  } catch {
    // Not allowed here; the page explains what to click.
  }
}

// Sign in through the backend's Google consent flow. Chrome shows it in its
// own window and gives back the final https://<id>.chromiumapp.org/ address,
// which carries the session token in its fragment (see backend/src/routes/auth.js).
async function signIn() {
  const { backendUrl } = await chrome.storage.local.get("backendUrl");
  if (!backendUrl) return { ok: false, error: "Connect to a backend first." };
  const url = `${trimUrl(backendUrl)}/auth/login?ext=${encodeURIComponent(chrome.runtime.id)}`;

  await chrome.storage.local.remove("authError");
  try {
    const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    const params = new URLSearchParams(new URL(redirect).hash.slice(1));
    const token = params.get("token");
    if (!token) throw new Error("Sign-in didn't return a session.");
    await chrome.storage.local.set({
      token,
      userId: params.get("userId"),
      email: params.get("email") || null,
    });
    return { ok: true };
  } catch (err) {
    // When the backend refuses the account, the flow ends on its "you haven't
    // been invited" page instead of a redirect, and the person closes the
    // window. Chrome reports that exactly like cancelling, so one message
    // covers both.
    const message =
      "Sign-in didn't finish. If you closed the window on purpose, try again. Otherwise, ask the person who invited you to check they added this Google account.";
    console.warn("Sign-in failed:", err.message);
    await chrome.storage.local.set({ authError: message });
    return { ok: false, error: message };
  }
}

async function signOut() {
  const { backendUrl, token } = await chrome.storage.local.get(["backendUrl", "token"]);
  if (backendUrl && token) {
    // End the session on the backend too. Best effort: sign out locally either way.
    fetch(`${trimUrl(backendUrl)}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  await chrome.storage.local.remove(IDENTITY_KEYS);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const reply = (promise) => {
    promise.then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
    return true; // async sendResponse
  };

  switch (message?.type) {
    case "GET_STATE":
      return reply(
        chrome.storage.local.get(["backendUrl", "pendingInvite", ...IDENTITY_KEYS]).then((d) => ({
          backendUrl: d.backendUrl || null,
          pendingInvite: d.pendingInvite || null,
          token: d.token || null,
          userId: d.userId || null,
          email: d.email || null,
          authError: d.authError || null,
        }))
      );

    case "CONNECT": // pasted into the popup, or a confirmed invite
      return reply(connect(message.text));

    case "DISMISS_INVITE":
      return reply(chrome.storage.local.remove("pendingInvite").then(() => ({ ok: true })));

    case "JOIN": // from join.js on an invite page
      if (!sender.tab) return false;
      return reply(
        join(message.url).then(async (result) => {
          if (result.ok || result.pending) await tryOpenPopup();
          return result;
        })
      );

    case "START_AUTH":
      return reply(signIn());

    case "SIGN_OUT":
      return reply(signOut().then(() => ({ ok: true })));

    default:
      return false;
  }
});
