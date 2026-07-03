const express = require("express");
const router = express.Router();
const db = require("../models/firestore");
const googleApi = require("../services/googleApi");

// ---------------------------------------------------------------------------
// POST /share
//
// Share the merged calendar with an email address.
// Body: { userId, groupId, email }
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  const { userId, groupId, email } = req.body;

  if (!userId || !groupId || !email) {
    return res.status(400).json({ error: "Required: userId, groupId, email" });
  }

  try {
    const group = await db.getGroup(userId, groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (!group.mergedCalendarId) {
      return res.status(400).json({ error: "Group has no merged calendar" });
    }

    // Check if already shared
    if (group.sharedWith?.includes(email)) {
      return res.status(409).json({ error: "Already shared with this email" });
    }

    // Grant read access via Google Calendar ACL
    await googleApi.shareCalendar(userId, group.mergedCalendarId, email);

    // Update Firestore
    const updatedSharedWith = [...(group.sharedWith || []), email];
    await db.updateGroup(userId, groupId, { sharedWith: updatedSharedWith });

    res.json({ shared: true, sharedWith: updatedSharedWith });
  } catch (err) {
    console.error("Share failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /share
//
// Remove sharing from an email address.
// Body: { userId, groupId, email }
// ---------------------------------------------------------------------------
router.delete("/", async (req, res) => {
  const { userId, groupId, email } = req.body;

  if (!userId || !groupId || !email) {
    return res.status(400).json({ error: "Required: userId, groupId, email" });
  }

  try {
    const group = await db.getGroup(userId, groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    // Revoke access via Google Calendar ACL
    try {
      await googleApi.unshareCalendar(userId, group.mergedCalendarId, email);
    } catch (e) {
      // 404 means the ACL rule didn't exist — fine
      if (e.code !== 404) throw e;
    }

    // Update Firestore
    const updatedSharedWith = (group.sharedWith || []).filter((e) => e !== email);
    await db.updateGroup(userId, groupId, { sharedWith: updatedSharedWith });

    res.json({ removed: true, sharedWith: updatedSharedWith });
  } catch (err) {
    console.error("Unshare failed:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
