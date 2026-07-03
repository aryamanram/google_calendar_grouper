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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

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
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function App() {
  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Calendar data from Google
  const [calendars, setCalendars] = useState([]);

  // Group state (MVP: one group)
  const [group, setGroup] = useState(null);
  const [groupName, setGroupName] = useState("My full schedule");

  // Local calendar selection state: { [calId]: { checked, detailLevel } }
  const [selections, setSelections] = useState({});

  // Share input
  const [shareEmail, setShareEmail] = useState("");
  const [sharing, setSharing] = useState(false);

  // ------ Auth ------
  useEffect(() => {
    // Check if we're already logged in
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" }, (response) => {
        if (response?.userId) {
          setUserId(response.userId);
          setEmail(response.email);
        }
        setLoading(false);
      });
    } else {
      // Running outside extension (dev mode) — check localStorage fallback
      const stored = localStorage.getItem("calGrouper_userId");
      if (stored) {
        setUserId(stored);
        setEmail(localStorage.getItem("calGrouper_email"));
      }
      setLoading(false);
    }
  }, []);

  // ------ Load calendars + existing group when userId is set ------
  useEffect(() => {
    if (!userId) return;

    async function load() {
      try {
        const [calRes, groupRes] = await Promise.all([
          api(`/auth/calendars?userId=${userId}`),
          api(`/groups?userId=${userId}`),
        ]);

        setCalendars(calRes.calendars);

        // For MVP, use the first group if it exists
        const existing = groupRes.groups[0] || null;
        setGroup(existing);

        if (existing) {
          setGroupName(existing.name);
          // Rebuild selections from the saved group config
          const sel = {};
          for (const cal of calRes.calendars) {
            const inGroup = existing.sourceCalendars.find((s) => s.id === cal.id);
            sel[cal.id] = {
              checked: !!inGroup,
              detailLevel: inGroup?.detailLevel || "full",
            };
          }
          setSelections(sel);
        } else {
          // Default: check all calendars
          const sel = {};
          for (const cal of calRes.calendars) {
            sel[cal.id] = { checked: true, detailLevel: "full" };
          }
          setSelections(sel);
        }
      } catch (err) {
        setError(err.message);
      }
    }

    load();
  }, [userId]);

  // ------ Handlers ------
  function handleLogin() {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "START_AUTH" });
    } else {
      window.open(`${BACKEND_URL}/auth/login`, "_blank");
    }
  }

  function toggleCalendar(calId) {
    setSelections((prev) => ({
      ...prev,
      [calId]: { ...prev[calId], checked: !prev[calId]?.checked },
    }));
  }

  function toggleDetailLevel(calId) {
    setSelections((prev) => ({
      ...prev,
      [calId]: {
        ...prev[calId],
        detailLevel: prev[calId]?.detailLevel === "full" ? "busy" : "full",
      },
    }));
  }

  async function handleSave() {
    setError(null);
    const sourceCalendars = calendars
      .filter((c) => selections[c.id]?.checked)
      .map((c) => ({
        id: c.id,
        summary: c.summary,
        detailLevel: selections[c.id]?.detailLevel || "full",
      }));

    if (sourceCalendars.length === 0) {
      setError("Select at least one calendar");
      return;
    }

    try {
      if (group) {
        // Update existing group
        const res = await api(`/groups/${group.id}`, {
          method: "PATCH",
          body: JSON.stringify({ userId, name: groupName, sourceCalendars }),
        });
        setGroup(res.group);
      } else {
        // Create new group
        const res = await api("/groups", {
          method: "POST",
          body: JSON.stringify({ userId, name: groupName, sourceCalendars }),
        });
        setGroup(res.group);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleShare() {
    if (!shareEmail || !group) return;
    setSharing(true);
    setError(null);

    try {
      const res = await api("/share", {
        method: "POST",
        body: JSON.stringify({ userId, groupId: group.id, email: shareEmail }),
      });
      setGroup((prev) => ({ ...prev, sharedWith: res.sharedWith }));
      setShareEmail("");
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
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
          <p style={styles.loginText}>
            Sign in with Google to group and share your calendars.
          </p>
          <button style={styles.btnPrimary} onClick={handleLogin}>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // ------ Render: main UI ------
  const checkedCount = Object.values(selections).filter((s) => s.checked).length;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerIcon}>G</div>
        <span style={styles.headerTitle}>Calendar Grouper</span>
        <button style={styles.btnText} onClick={handleSave}>
          {group ? "Update" : "Create"}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Group name */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Shared calendar name</div>
        <input
          style={styles.nameInput}
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="My full schedule"
        />
      </div>

      {/* Calendar list */}
      <div style={{ ...styles.section, paddingTop: 0 }}>
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
                style={styles.checkbox(cal.backgroundColor)}
              />
              <div
                style={styles.detailDot(sel.detailLevel)}
                title={sel.detailLevel === "busy" ? "Busy only — click for full details" : "Full details — click for busy only"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDetailLevel(cal.id);
                }}
              />
              <span style={styles.calName}>{cal.summary}</span>
              {sel.detailLevel === "busy" && (
                <span style={styles.busyBadge}>busy</span>
              )}
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
          <span style={{ fontSize: 10, color: "#9aa0a6", marginLeft: 4 }}>
            tap dot to toggle
          </span>
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
              Share
            </button>
          </div>

          {/* Shared-with chips */}
          {group.sharedWith?.map((addr) => (
            <div key={addr} style={styles.shareChip}>
              <span style={styles.shareChipEmail}>{addr}</span>
              <button
                style={styles.removeBtn}
                onClick={() => handleUnshare(addr)}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Sync status */}
      {group && (
        <div style={styles.status}>
          <span>✓</span>
          <span>
            Syncing {checkedCount} calendar{checkedCount !== 1 ? "s" : ""} → "{group.name}"
          </span>
        </div>
      )}
      {group?.lastSyncedAt && (
        <div style={styles.statusSub}>
          Last synced {new Date(group.lastSyncedAt).toLocaleTimeString()} · live sync via webhooks
        </div>
      )}
    </div>
  );
}
