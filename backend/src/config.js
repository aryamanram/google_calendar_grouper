// ---------------------------------------------------------------------------
// Settings that hold a list
//
// ALLOWED_EMAILS and EXTENSION_ID can each hold several values, separated by
// commas, semicolons or spaces. (gcloud uses commas to separate variables in
// --set-env-vars, so semicolons or spaces are easier to pass on the command
// line.)
// ---------------------------------------------------------------------------

function listSetting(name) {
  return (process.env[name] || "")
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

// Google accounts allowed to sign in, lower-cased.
function allowedEmails() {
  return listSetting("ALLOWED_EMAILS").map((e) => e.toLowerCase());
}

// IDs of the installed extensions allowed to call this backend. Each person's
// copy has its own ID (shown on chrome://extensions).
function extensionIds() {
  return listSetting("EXTENSION_ID");
}

// Chrome extension IDs are 32 letters from a to p.
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

module.exports = { listSetting, allowedEmails, extensionIds, EXTENSION_ID_PATTERN };
