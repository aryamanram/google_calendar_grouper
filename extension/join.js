// ---------------------------------------------------------------------------
// Runs on https://calendargrouper.com/join, the page invite links open.
//
// Hands the invite (its backend address is in the URL fragment) to the
// background worker, then tells the page how it went so it can show the next
// step. The page works without this script too: it then explains how to
// install the extension or paste the link.
// ---------------------------------------------------------------------------
(() => {
  const root = document.documentElement;
  const announce = (state, detail = {}) => {
    root.dataset.calendarGrouper = state;
    window.dispatchEvent(new CustomEvent("calendar-grouper", { detail: { state, ...detail } }));
  };

  function join() {
    if (!location.hash.includes("backend=")) return;
    announce("checking");
    chrome.runtime.sendMessage({ type: "JOIN", url: location.href }, (result) => {
      if (chrome.runtime.lastError || !result) {
        announce("error", { error: "The extension didn't respond. Reload this page to try again." });
      } else if (result.ok) {
        announce("connected", { backendUrl: result.backendUrl });
      } else {
        announce("error", { error: result.error });
      }
    });
  }

  announce("installed");
  join();
  window.addEventListener("hashchange", join); // another invite opened in this tab
})();
