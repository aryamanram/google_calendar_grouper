import React, { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Config
//
// The backend URL and API key are entered on the popup's setup screen and kept
// in chrome.storage.local, so switching between the local and cloud backend
// needs no rebuild.
// ---------------------------------------------------------------------------
const DEFAULT_BACKEND_URL = "http://localhost:3000";
let backendUrl = DEFAULT_BACKEND_URL;
let apiKey = null;

function configure(settings) {
  backendUrl = (settings?.backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
  apiKey = settings?.apiKey || null;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  let res;
  try {
    res = await fetch(`${backendUrl}${path}`, { ...options, headers });
  } catch {
    throw new Error(`Can't reach the backend at ${backendUrl}. Is it running?`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      res.status === 401
        ? "The backend rejected the API key. Open Settings at the bottom to check it."
        : body.error || `API error ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const inExtension = typeof chrome !== "undefined" && !!chrome.runtime?.sendMessage;

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

const COOLDOWN_MS = 3000; // buttons stay disabled briefly after each action
const POLL_MS = 2500;     // how often to check sync progress

// ---------------------------------------------------------------------------
// Styles — Google Calendar aesthetic
// ---------------------------------------------------------------------------
const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    minHeight: 200,
  },
  header: {
    padding: "14px 16px 10px",
    borderBottom: "1px solid #e0e0e0",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  headerIcon: {
    width: 20,
    height: 20,
    borderRadius: 4,
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: "#202124",
    flex: 1,
  },
  section: {
    padding: "10px 16px",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: "#5f6368",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  calRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "5px 6px",
    borderRadius: 4,
    cursor: "pointer",
    transition: "background 0.15s",
  },
  checkbox: (color) => ({
    width: 16,
    height: 16,
    accentColor: color,
    cursor: "pointer",
    flexShrink: 0,
  }),
  detailDot: (mode) => ({
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: mode === "busy" ? "#ea4335" : "#4285f4",
    cursor: "pointer",
    flexShrink: 0,
    transition: "background 0.15s",
  }),
  calName: {
    fontSize: 13,
    color: "#202124",
    flex: 1,
  },
  busyBadge: {
    fontSize: 10,
    color: "#ea4335",
    background: "#fce8e6",
    padding: "1px 6px",
    borderRadius: 99,
    fontWeight: 500,
  },
  input: {
    flex: 1,
    fontSize: 13,
    padding: "7px 10px",
    border: "1px solid #dadce0",
    borderRadius: 4,
    outline: "none",
    color: "#202124",
  },
  btnPrimary: {
    padding: "7px 14px",
    fontSize: 13,
    background: "#4285f4",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  btnText: {
    padding: "6px 10px",
    fontSize: 12,
    background: "transparent",
    color: "#4285f4",
    border: "none",
    cursor: "pointer",
    fontWeight: 500,
  },
  nameInput: {
    width: "100%",
    fontSize: 13,
    padding: "7px 10px",
    border: "1px solid #dadce0",
    borderRadius: 4,
    outline: "none",
    color: "#202124",
    marginBottom: 10,
  },
  shareChip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    background: "#f1f3f4",
    borderRadius: 6,
    marginTop: 6,
  },
  shareChipEmail: {
    fontSize: 12,
    color: "#5f6368",
    flex: 1,
  },
  removeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#5f6368",
    fontSize: 14,
    padding: 2,
    lineHeight: 1,
  },
  status: {
    padding: "10px 16px",
    borderTop: "1px solid #e0e0e0",
    fontSize: 12,
    color: "#34a853",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  statusSub: {
    fontSize: 11,
    color: "#9aa0a6",
    marginLeft: 20,
  },
  loginContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 20px",
    gap: 16,
  },
  fieldLabel: {
    display: "block",
    fontSize: 12,
    color: "#5f6368",
    margin: "10px 0 4px",
  },
  hint: {
    fontSize: 11,
    color: "#9aa0a6",
    marginTop: 4,
    lineHeight: 1.4,
  },
  code: {
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    fontSize: 11,
    background: "#f1f3f4",
    padding: "1px 4px",
    borderRadius: 3,
    userSelect: "all",
  },
  accountBar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "8px 16px 12px",
    borderTop: "1px solid #e0e0e0",
    fontSize: 11,
    color: "#9aa0a6",
  },
  loginText: {
    fontSize: 13,
    color: "#5f6368",
    textAlign: "center",
  },
  error: {
    padding: "8px 16px",
    fontSize: 12,
    color: "#d93025",
    background: "#fce8e6",
  },
  divider: {
    borderTop: "1px solid #e0e0e0",
  },
  legend: {
    padding: "6px 16px 10px",
    borderTop: "1px solid #e0e0e0",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  legendRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "#5f6368",
  },
  legendDot: (color) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
  legendDefault: {
    fontSize: 10,
    color: "#9aa0a6",
    background: "#f1f3f4",
    padding: "1px 6px",
    borderRadius: 99,
  },
  notice: (kind) => ({
    padding: "8px 16px",
    fontSize: 12,
    color: kind === "error" ? "#d93025" : kind === "success" ? "#137333" : "#1967d2",
    background: kind === "error" ? "#fce8e6" : kind === "success" ? "#e6f4ea" : "#e8f0fe",
  }),
  statusLine: (state) => ({
    padding: "10px 16px 2px",
    borderTop: "1px solid #e0e0e0",
    fontSize: 12,
    color: state === "error" ? "#d93025" : state === "syncing" ? "#b06000" : "#137333",
    display: "flex",
    alignItems: "center",
    gap: 6,
  }),
  footer: {
    padding: "8px 16px 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  btnDanger: (confirming) => ({
    padding: "6px 10px",
    fontSize: 12,
    background: confirming ? "#d93025" : "transparent",
    color: confirming ? "#fff" : "#d93025",
    border: "1px solid #d93025",
    borderRadius: 4,
    cursor: "pointer",
    fontWeight: 500,
  }),
};


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function App() {
  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(true);

  // Setup screen: where the backend is, and its API key
  const [showSetup, setShowSetup] = useState(false);
  const [setupUrl, setSetupUrl] = useState(DEFAULT_BACKEND_URL);
  const [setupKey, setSetupKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [configuredUrl, setConfiguredUrl] = useState(null); // saved backend, if any

  const [signingIn, setSigningIn] = useState(false);

  // { kind: "info" | "success" | "error", text }
  const [notice, setNotice] = useState(null);

  // Calendar data from Google
  const [calendars, setCalendars] = useState([]);

  // Group state (MVP: one group)
  const [group, setGroup] = useState(null);
  const [groupName, setGroupName] = useState("My full schedule");

  // Local calendar selection state: { [calId]: { checked, detailLevel } }
  const [selections, setSelections] = useState({});

  // What the popup is doing right now: null | "creating" | "updating" | "syncing" | "deleting"
  const [busy, setBusy] = useState(null);
  const [coolingDown, setCoolingDown] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Share input
  const [shareEmail, setShareEmail] = useState("");
  const [sharing, setSharing] = useState(false);

  const syncing = group?.status === "syncing";
  const locked = !!busy || coolingDown || syncing;

  function startCooldown() {
    setCoolingDown(true);
    setTimeout(() => setCoolingDown(false), COOLDOWN_MS);
  }

  // Build checkbox state from a saved group (or check everything if none).
  function selectionsFor(cals, savedGroup) {
    const sel = {};
    for (const cal of cals) {
      const inGroup = savedGroup?.sourceCalendars.find((s) => s.id === cal.id);
      sel[cal.id] = savedGroup
        ? { checked: !!inGroup, detailLevel: inGroup?.detailLevel || "full" }
        : { checked: true, detailLevel: "full" };
    }
    return sel;
  }

  // ------ Settings and sign-in state ------
  useEffect(() => {
    if (!inExtension) {
      // Running outside the extension (vite dev server)
      const stored = localStorage.getItem("calGrouper_userId");
      if (stored) {
        setUserId(stored);
        setEmail(localStorage.getItem("calGrouper_email"));
      }
      setLoading(false);
      return;
    }

    send({ type: "GET_AUTH_STATE" }).then((response) => {
      configure(response); // before setUserId, which triggers the first API call
      setSetupUrl(response?.backendUrl || DEFAULT_BACKEND_URL);
      setSetupKey(response?.apiKey || "");
      setConfiguredUrl(response?.backendUrl || null);
      if (!response?.backendUrl) {
        setShowSetup(true); // first run
      } else if (response.userId) {
        setUserId(response.userId);
        setEmail(response.email);
      } else if (response.authError) {
        setNotice({ kind: "error", text: response.authError });
      }
      setLoading(false);
    });

    // Sign-in finishes in the background worker. If the popup is still open
    // when it does, pick up the result.
    function onChanged(changes, area) {
      if (area !== "local") return;
      if (changes.userId?.newValue) {
        setUserId(changes.userId.newValue);
        setEmail(changes.email?.newValue || null);
        setSigningIn(false);
        setNotice(null);
      }
      if (changes.authError?.newValue) {
        setSigningIn(false);
        setNotice({ kind: "error", text: changes.authError.newValue });
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // ------ Load calendars + existing group ------
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [calRes, groupRes] = await Promise.all([
        api(`/auth/calendars?userId=${userId}`),
        api(`/groups?userId=${userId}`),
      ]);
      const existing = groupRes.groups[0] || null;
      setCalendars(calRes.calendars);
      setGroup(existing);
      if (existing) setGroupName(existing.name);
      setSelections(selectionsFor(calRes.calendars, existing));
    } catch (err) {
      setNotice({ kind: "error", text: err.message });
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // ------ Poll while events are being copied ------
  // Paused during a delete. `alive` turns false when this effect is torn down
  // (delete starts, group changes, popup closes), so a request that was
  // already in flight can't bring a deleted group back.
  useEffect(() => {
    if (!userId || !group?.id || group.status !== "syncing" || busy === "deleting") return;

    let alive = true;
    const timer = setInterval(async () => {
      try {
        const res = await api(`/groups/${group.id}?userId=${userId}`);
        if (!alive) return;
        setGroup(res.group);
        if (res.group.status === "ready") {
          setNotice({ kind: "success", text: "All events copied. Your shared calendar is up to date." });
        } else if (res.group.status === "error") {
          setNotice({ kind: "error", text: `Sync stopped: ${res.group.lastError}` });
        }
      } catch (err) {
        if (alive && err.status === 404) setGroup(null); // deleted elsewhere
      }
    }, POLL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId, group?.id, group?.status, busy]);

  // ------ Handlers ------
  function handleLogin() {
    setNotice(null);
    if (inExtension) {
      setSigningIn(true);
      send({ type: "START_AUTH" }); // the result arrives through storage
    } else {
      window.open(`${backendUrl}/auth/login`, "_blank");
    }
  }

  function handleLogout() {
    send({ type: "LOGOUT" }).then(() => {
      setUserId(null);
      setEmail(null);
      setGroup(null);
      setCalendars([]);
      setNotice(null);
    });
  }

  // Save the backend URL and API key, after checking they work.
  async function handleSaveSetup(e) {
    e?.preventDefault();
    const url = setupUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/.test(url)) {
      setNotice({ kind: "error", text: "Enter the backend's full address, starting with https://" });
      return;
    }
    setChecking(true);
    setNotice(null);
    try {
      const headers = setupKey.trim() ? { "x-api-key": setupKey.trim() } : {};
      let res;
      try {
        res = await fetch(`${url}/auth/check`, { headers });
      } catch {
        throw new Error(
          `Can't reach ${url}. Check the address, and that this extension's ID is in the backend's EXTENSION_ID.`
        );
      }
      if (res.status === 401) throw new Error("The backend rejected that API key.");
      if (!res.ok) throw new Error(`The backend answered with an error (${res.status}). Is the address right?`);

      await send({ type: "SAVE_SETTINGS", backendUrl: url, apiKey: setupKey });
      configure({ backendUrl: url, apiKey: setupKey.trim() });
      setConfiguredUrl(url);
      setShowSetup(false);
      setNotice({ kind: "success", text: "Connected to the backend." });
      if (userId) load();
    } catch (err) {
      setNotice({ kind: "error", text: err.message });
    } finally {
      setChecking(false);
    }
  }

  function toggleCalendar(calId) {
    if (locked) return;
    setSelections((prev) => ({
      ...prev,
      [calId]: { ...prev[calId], checked: !prev[calId]?.checked },
    }));
  }

  function toggleDetailLevel(calId) {
    if (locked) return;
    setSelections((prev) => ({
      ...prev,
      [calId]: {
        ...prev[calId],
        detailLevel: prev[calId]?.detailLevel === "full" ? "busy" : "full",
      },
    }));
  }

  async function handleSave() {
    if (locked) return; // ignores double-clicks and clicks during a sync
    setNotice(null);

    const sourceCalendars = calendars
      .filter((c) => selections[c.id]?.checked)
      .map((c) => ({
        id: c.id,
        summary: c.summary,
        detailLevel: selections[c.id]?.detailLevel || "full",
      }));

    if (sourceCalendars.length === 0) {
      setNotice({ kind: "error", text: "Select at least one calendar." });
      return;
    }
    if (!groupName.trim()) {
      setNotice({ kind: "error", text: "Give the shared calendar a name." });
      return;
    }

    const creating = !group;
    setBusy(creating ? "creating" : "updating");
    try {
      const res = creating
        ? await api("/groups", {
            method: "POST",
            body: JSON.stringify({ userId, name: groupName, sourceCalendars }),
          })
        : await api(`/groups/${group.id}`, {
            method: "PATCH",
            body: JSON.stringify({ userId, name: groupName, sourceCalendars }),
          });
      setGroup(res.group);
      setNotice(
        res.group.status === "syncing"
          ? { kind: "info", text: "Copying events. This can take a minute, and you can close this popup." }
          : { kind: "success", text: "Saved." }
      );
    } catch (err) {
      if (err.body?.code === "GROUP_EXISTS") {
        // Another click or another window already created it. Load that one.
        setGroup(err.body.group);
        setGroupName(err.body.group.name);
        setSelections(selectionsFor(calendars, err.body.group));
        setNotice({ kind: "info", text: "You already have a shared calendar, so it's loaded below." });
      } else {
        // A failed copy still returns the group (status "error"), so show it
        // with its Retry button instead of losing track of it.
        if (err.body?.group) {
          setGroup(err.body.group);
          setGroupName(err.body.group.name);
          setSelections(selectionsFor(calendars, err.body.group));
        }
        setNotice({ kind: "error", text: err.message });
      }
    } finally {
      setBusy(null);
      startCooldown();
    }
  }

  // "Sync now" / "Retry": re-check every included calendar in the background.
  async function handleSyncNow() {
    if (!group || locked) return;
    setBusy("syncing");
    setNotice(null);
    try {
      const res = await api(`/groups/${group.id}/sync`, {
        method: "POST",
        body: JSON.stringify({ userId, wait: false }),
      });
      setGroup(res.group); // status "syncing" starts the progress poll
    } catch (err) {
      if (err.body?.group) setGroup(err.body.group);
      setNotice({ kind: "error", text: err.message });
    } finally {
      setBusy(null);
      startCooldown();
    }
  }

  async function handleDelete() {
    if (!group || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }

    setConfirmDelete(false);
    setBusy("deleting");
    setNotice(null);
    try {
      await api(`/groups/${group.id}?userId=${userId}`, { method: "DELETE" });
      setGroup(null);
      setNotice({
        kind: "success",
        text: "Shared calendar deleted. Anyone you shared it with no longer sees it.",
      });
      await load();
    } catch (err) {
      setNotice({ kind: "error", text: err.message });
    } finally {
      setBusy(null);
      startCooldown();
    }
  }

  async function handleShare() {
    if (!shareEmail || !group || sharing) return;
    setSharing(true);
    setNotice(null);
    try {
      const res = await api("/share", {
        method: "POST",
        body: JSON.stringify({ userId, groupId: group.id, email: shareEmail }),
      });
      setGroup((prev) => ({ ...prev, sharedWith: res.sharedWith }));
      setShareEmail("");
      setNotice({ kind: "success", text: `Shared with ${shareEmail}.` });
    } catch (err) {
      setNotice({ kind: "error", text: err.message });
    } finally {
      setSharing(false);
    }
  }

  async function handleUnshare(emailToRemove) {
    try {
      const res = await api("/share", {
        method: "DELETE",
        body: JSON.stringify({ userId, groupId: group.id, email: emailToRemove }),
      });
      setGroup((prev) => ({ ...prev, sharedWith: res.sharedWith }));
    } catch (err) {
      setNotice({ kind: "error", text: err.message });
    }
  }

  // ------ Render: setup and login screens ------
  if (loading) return null;

  const header = (
    <div style={styles.header}>
      <img src="../../assets/icon128.png" alt="" style={styles.headerIcon} />
      <span style={styles.headerTitle}>Calendar Grouper</span>
    </div>
  );

  if (showSetup) {
    return (
      <div style={styles.container}>
        {header}
        {notice && <div style={styles.notice(notice.kind)}>{notice.text}</div>}
        <form style={styles.section} onSubmit={handleSaveSetup}>
          <div style={{ ...styles.sectionLabel, marginTop: 4 }}>Connect to your backend</div>
          <p style={{ ...styles.loginText, textAlign: "left" }}>
            Get these from whoever runs your Calendar Grouper backend.
          </p>

          <label style={styles.fieldLabel} htmlFor="backend-url">Backend address</label>
          <input
            id="backend-url"
            style={{ ...styles.nameInput, marginBottom: 0 }}
            value={setupUrl}
            onChange={(e) => setSetupUrl(e.target.value)}
            placeholder="https://calendar-grouper-….run.app"
            autoFocus
          />

          <label style={styles.fieldLabel} htmlFor="api-key">API key</label>
          <input
            id="api-key"
            type="password"
            style={{ ...styles.nameInput, marginBottom: 0 }}
            value={setupKey}
            onChange={(e) => setSetupKey(e.target.value)}
            placeholder="Not needed for a local backend"
            autoComplete="off"
          />

          {inExtension && (
            <div style={{ ...styles.hint, marginTop: 12 }}>
              This extension's ID is <span style={styles.code}>{chrome.runtime.id}</span>. The backend's{" "}
              <span style={styles.code}>EXTENSION_ID</span> setting must include it.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            {configuredUrl && (
              <button
                type="button"
                style={styles.btnText}
                onClick={() => {
                  setShowSetup(false);
                  setNotice(null);
                }}
              >
                Cancel
              </button>
            )}
            <button type="submit" style={{ ...styles.btnPrimary, opacity: checking ? 0.6 : 1 }} disabled={checking}>
              {checking ? "Checking…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (!userId) {
    return (
      <div style={styles.container}>
        {header}
        {notice && <div style={styles.notice(notice.kind)}>{notice.text}</div>}
        <div style={styles.loginContainer}>
          <p style={styles.loginText}>Sign in with Google to group and share your calendars.</p>
          <button
            style={{ ...styles.btnPrimary, opacity: signingIn ? 0.6 : 1 }}
            onClick={handleLogin}
            disabled={signingIn}
          >
            {signingIn ? "Waiting for Google…" : "Sign in with Google"}
          </button>
        </div>
        {inExtension && (
          <div style={styles.accountBar}>
            <span style={{ flex: 1 }}>Backend: {backendUrl.replace(/^https?:\/\//, "")}</span>
            <button style={{ ...styles.btnText, padding: 0, fontSize: 11 }} onClick={() => setShowSetup(true)}>
              Change
            </button>
          </div>
        )}
      </div>
    );
  }

  // ------ Render: main UI ------
  const saveLabel =
    busy === "creating" ? "Creating…" :
    busy === "updating" ? "Saving…" :
    syncing ? "Syncing…" :
    group ? "Update" : "Create";

  const includedCount = group?.sourceCalendars?.length || 0;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <img src="../../assets/icon128.png" alt="" style={styles.headerIcon} />
        <span style={styles.headerTitle}>Calendar Grouper</span>
        <button
          style={{ ...styles.btnText, opacity: locked ? 0.45 : 1, cursor: locked ? "default" : "pointer" }}
          onClick={handleSave}
          disabled={locked}
        >
          {saveLabel}
        </button>
      </div>

      {notice && <div style={styles.notice(notice.kind)}>{notice.text}</div>}

      {/* Group name */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Shared calendar name</div>
        <input
          style={styles.nameInput}
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="My full schedule"
          disabled={locked}
        />
      </div>

      {/* Calendar list */}
      <div style={{ ...styles.section, paddingTop: 0, opacity: locked ? 0.6 : 1 }}>
        <div style={styles.sectionLabel}>My calendars</div>
        {calendars.map((cal) => {
          const sel = selections[cal.id] || { checked: false, detailLevel: "full" };
          return (
            <div
              key={cal.id}
              style={styles.calRow}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f3f4")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <input
                type="checkbox"
                checked={sel.checked}
                onChange={() => toggleCalendar(cal.id)}
                disabled={locked}
                style={styles.checkbox(cal.backgroundColor)}
              />
              <div
                style={styles.detailDot(sel.detailLevel)}
                title={
                  sel.detailLevel === "busy"
                    ? "Busy only — click for full details"
                    : "Full details — click for busy only"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDetailLevel(cal.id);
                }}
              />
              <span style={styles.calName}>{cal.summary}</span>
              {sel.detailLevel === "busy" && <span style={styles.busyBadge}>busy</span>}
            </div>
          );
        })}
      </div>

      {/* Detail level legend */}
      <div style={styles.legend}>
        <div style={styles.sectionLabel}>Detail level per calendar</div>
        <div style={styles.legendRow}>
          <span style={styles.legendDot("#4285f4")} />
          <span style={{ flex: 1 }}>Full details</span>
          <span style={styles.legendDefault}>default</span>
        </div>
        <div style={styles.legendRow}>
          <span style={styles.legendDot("#ea4335")} />
          <span>Busy only</span>
          <span style={{ fontSize: 10, color: "#9aa0a6", marginLeft: 4 }}>tap dot to toggle</span>
        </div>
      </div>

      {/* Share section */}
      {group && (
        <div style={{ ...styles.section, ...styles.divider, paddingTop: 12 }}>
          <div style={styles.sectionLabel}>Share with</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={styles.input}
              type="email"
              placeholder="email@example.com"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleShare()}
            />
            <button
              style={{ ...styles.btnPrimary, opacity: sharing ? 0.6 : 1 }}
              onClick={handleShare}
              disabled={sharing}
            >
              {sharing ? "Sharing…" : "Share"}
            </button>
          </div>

          {group.sharedWith?.map((addr) => (
            <div key={addr} style={styles.shareChip}>
              <span style={styles.shareChipEmail}>{addr}</span>
              <button style={styles.removeBtn} onClick={() => handleUnshare(addr)} title="Remove">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Sync status */}
      {group && (
        <div style={styles.statusLine(group.status)}>
          {group.status === "syncing" && <span>● Copying events into "{group.name}"…</span>}
          {group.status === "error" && (
            <>
              <span style={{ flex: 1 }} title={group.lastError || ""}>
                ✕ Last sync failed
              </span>
              <button
                style={{ ...styles.btnText, padding: "2px 6px", opacity: locked ? 0.45 : 1 }}
                onClick={handleSyncNow}
                disabled={locked}
              >
                Retry
              </button>
            </>
          )}
          {(group.status === "ready" || !group.status) && (
            <span>
              ✓ Sharing {includedCount} calendar{includedCount !== 1 ? "s" : ""} → "{group.name}"
            </span>
          )}
        </div>
      )}
      {group && group.status !== "syncing" && (
        <div style={{ ...styles.statusSub, paddingTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
          <span>
            {group.lastSyncedAt
              ? `Last checked ${new Date(group.lastSyncedAt).toLocaleTimeString()} · new events appear within a couple of minutes`
              : "New events appear within a couple of minutes"}
          </span>
          {group.status !== "error" && (
            <button
              style={{ ...styles.btnText, padding: 0, fontSize: 11, opacity: locked ? 0.45 : 1 }}
              onClick={handleSyncNow}
              disabled={locked}
            >
              {busy === "syncing" ? "Starting…" : "Sync now"}
            </button>
          )}
        </div>
      )}

      {/* Delete */}
      {group && (
        <div style={styles.footer}>
          <span style={{ fontSize: 11, color: "#9aa0a6" }}>
            {confirmDelete ? "Removes it for everyone you shared with." : ""}
          </span>
          <button
            style={{ ...styles.btnDanger(confirmDelete), opacity: busy ? 0.5 : 1 }}
            onClick={handleDelete}
            disabled={!!busy}
          >
            {busy === "deleting" ? "Deleting…" : confirmDelete ? "Click again to delete" : "Delete shared calendar"}
          </button>
        </div>
      )}

      {/* Account */}
      <div style={styles.accountBar}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</span>
        {inExtension && (
          <button style={{ ...styles.btnText, padding: "0 4px", fontSize: 11 }} onClick={() => setShowSetup(true)}>
            Settings
          </button>
        )}
        <button style={{ ...styles.btnText, padding: "0 4px", fontSize: 11 }} onClick={handleLogout} disabled={!!busy}>
          Sign out
        </button>
      </div>
    </div>
  );
}
