import React, { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Config — swap for production URL when deploying
// ---------------------------------------------------------------------------
const BACKEND_URL = "http://localhost:3000";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `API error ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
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
    background: "#4285f4",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
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

  // { kind: "info" | "success" | "error", text }
  const [notice, setNotice] = useState(null);

  // Calendar data from Google
  const [calendars, setCalendars] = useState([]);

  // Group state (MVP: one group)
  const [group, setGroup] = useState(null);
  const [groupName, setGroupName] = useState("My full schedule");

  // Local calendar selection state: { [calId]: { checked, detailLevel } }
  const [selections, setSelections] = useState({});

  // What the popup is doing right now: null | "creating" | "updating" | "deleting"
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

  // ------ Auth ------
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" }, (response) => {
        if (response?.userId) {
          setUserId(response.userId);
          setEmail(response.email);
        }
        setLoading(false);
      });
    } else {
      // Running outside the extension (vite dev server)
      const stored = localStorage.getItem("calGrouper_userId");
      if (stored) {
        setUserId(stored);
        setEmail(localStorage.getItem("calGrouper_email"));
      }
      setLoading(false);
    }
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
  useEffect(() => {
    if (!userId || !group?.id || group.status !== "syncing") return;

    const timer = setInterval(async () => {
      try {
        const res = await api(`/groups/${group.id}?userId=${userId}`);
        setGroup(res.group);
        if (res.group.status === "ready") {
          setNotice({ kind: "success", text: "All events copied. Your shared calendar is up to date." });
        } else if (res.group.status === "error") {
          setNotice({ kind: "error", text: `Sync stopped: ${res.group.lastError}` });
        }
      } catch (err) {
        if (err.status === 404) setGroup(null); // deleted elsewhere
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [userId, group?.id, group?.status]);

  // ------ Handlers ------
  function handleLogin() {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "START_AUTH" });
    } else {
      window.open(`${BACKEND_URL}/auth/login`, "_blank");
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
        setSelections(selectionsFor(calendars, err.body.group));
        setNotice({ kind: "info", text: "You already have a shared calendar, so it's loaded below." });
      } else {
        setNotice({ kind: "error", text: err.message });
      }
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

  // ------ Render: login screen ------
  if (loading) return null;

  if (!userId) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerIcon}>G</div>
          <span style={styles.headerTitle}>Calendar Grouper</span>
        </div>
        <div style={styles.loginContainer}>
          <p style={styles.loginText}>Sign in with Google to group and share your calendars.</p>
          <button style={styles.btnPrimary} onClick={handleLogin}>
            Sign in with Google
          </button>
        </div>
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
        <div style={styles.headerIcon}>G</div>
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
          {group.status === "error" && <span>✕ Last sync failed. Click Update to retry.</span>}
          {(group.status === "ready" || !group.status) && (
            <span>
              ✓ Syncing {includedCount} calendar{includedCount !== 1 ? "s" : ""} → "{group.name}"
            </span>
          )}
        </div>
      )}
      {group?.lastSyncedAt && (
        <div style={{ ...styles.statusSub, paddingTop: 2 }}>
          Last synced {new Date(group.lastSyncedAt).toLocaleTimeString()}
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
    </div>
  );
}
