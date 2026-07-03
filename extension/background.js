// ---------------------------------------------------------------------------
// Background service worker for Calendar Grouper
//
// Responsibilities:
// 1. Listen for auth completion from the callback page
// 2. Store userId/email in chrome.storage for the popup to read
// 3. Relay messages between popup and backend when needed
// ---------------------------------------------------------------------------

const BACKEND_URL = "http://localhost:3000"; // Updated at build time for production

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_AUTH_STATE") {
    chrome.storage.local.get(["userId", "email"], (data) => {
      sendResponse({ userId: data.userId || null, email: data.email || null });
    });
    return true; // async sendResponse
  }

  if (message.type === "START_AUTH") {
    // Open the backend's auth URL in a new tab
    chrome.tabs.create({
      url: `${BACKEND_URL}/auth/login`,
    });
    sendResponse({ started: true });
    return true;
  }

  if (message.type === "SET_AUTH_STATE") {
    chrome.storage.local.set({
      userId: message.userId,
      email: message.email,
    });
    sendResponse({ saved: true });
    return true;
  }

  if (message.type === "LOGOUT") {
    chrome.storage.local.remove(["userId", "email"], () => {
      sendResponse({ cleared: true });
    });
    return true;
  }
});

// Listen for the auth callback page to send a message via BroadcastChannel.
// Since service workers can't use BroadcastChannel, we instead poll
// chrome.storage for changes or use chrome.runtime.onMessageExternal.
// For MVP, the popup polls the backend or the user manually closes the tab.

console.log("Calendar Grouper background worker initialized");
