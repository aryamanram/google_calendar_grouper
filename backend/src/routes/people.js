const express = require("express");
const router = express.Router();
const db = require("../models/firestore");
const access = require("../services/access");

// ---------------------------------------------------------------------------
// /people: who can use this backend. Owners only (see index.js).
//
// GET    /people          { owners: [email], members: [{ email, addedBy, addedAt }] }
// POST   /people          { email }  invite someone
// DELETE /people/:email   remove someone and sign them out everywhere
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function listPeople() {
  const members = await db.listMembers();
  const owners = access.ownerEmails();
  return {
    owners,
    members: members
      .filter((m) => !owners.includes(m.email))
      .sort((a, b) => a.email.localeCompare(b.email)),
  };
}

router.get("/", async (_req, res, next) => {
  try {
    res.json(await listPeople());
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  const email = access.normalize(req.body?.email);
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (access.isOwner(email)) {
    return res.status(409).json({ error: "That's an owner of this backend, so they already have access." });
  }
  try {
    await db.addMember(email, req.user.email);
    access.forgetMembers();
    console.log(`${req.user.email} invited ${email}`);
    res.status(201).json(await listPeople());
  } catch (err) {
    next(err);
  }
});

router.delete("/:email", async (req, res, next) => {
  const email = access.normalize(req.params.email);
  if (access.isOwner(email)) {
    return res
      .status(400)
      .json({ error: "Owners are set by ALLOWED_EMAILS on the backend and can't be removed here." });
  }
  try {
    await db.removeMember(email);
    access.forgetMembers();
    await access.revokeEmail(email);
    console.log(`${req.user.email} removed ${email}`);
    res.json(await listPeople());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
