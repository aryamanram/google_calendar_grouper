require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const groupRoutes = require("./routes/groups");
const webhookRoutes = require("./routes/webhooks");
const shareRoutes = require("./routes/share");
const { initFirestore } = require("./models/firestore");
const { startWatchRenewalJob } = require("./services/watchManager");
const { startAutoSync, pollOnce } = require("./services/autoSync");
const { requireApiKey, requireTickSecret } = require("./middleware/auth");
const { IS_CLOUD, RUN_MODE } = require("./runMode");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(
  cors({
    origin: [
      `chrome-extension://${process.env.EXTENSION_ID}`,
      "http://localhost:5173", // Vite dev server for popup
    ],
    credentials: true,
  })
);

// Parse JSON for all routes EXCEPT webhooks (Google sends empty bodies with
// channel info in headers, and we don't want bodyParser to choke on it).
app.use((req, res, next) => {
  if (req.path.startsWith("/webhooks")) return next();
  express.json()(req, res, next);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
// /auth/login and /auth/callback are opened in a browser tab, so they can't
// send a header; /auth/calendars checks the API key itself (see auth.js).
app.use("/auth", authRoutes);
app.use("/groups", requireApiKey, groupRoutes);
app.use("/share", requireApiKey, shareRoutes);
app.use("/webhooks", webhookRoutes); // called by Google; checked by channel ID

// Cloud Scheduler calls this every couple of minutes in cloud mode. It runs
// one auto-sync pass and replies when it's done, so Cloud Run keeps the CPU
// on for the whole pass.
app.post("/internal/tick", requireTickSecret, async (_req, res) => {
  try {
    res.json(await pollOnce());
  } catch (err) {
    console.error("Tick failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok", mode: RUN_MODE }));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  if (IS_CLOUD) {
    const missing = ["API_KEY", "TICK_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI", "EXTENSION_ID"].filter((k) => !process.env[k]?.trim());
    // An empty allow-list would let any Google account sign in.
    if (authRoutes.allowedEmails().length === 0) missing.push("ALLOWED_EMAILS");
    if (missing.length) {
      throw new Error(`Cloud mode needs these environment variables: ${missing.join(", ")}`);
    }
  }

  await initFirestore();

  if (IS_CLOUD) {
    // No timers: Cloud Run pauses the CPU between requests. Cloud Scheduler
    // drives auto-sync through POST /internal/tick instead.
    console.log("Cloud mode: auto-sync runs when Cloud Scheduler calls /internal/tick");
  } else {
    // Renew expiring watch channels once per hour
    startWatchRenewalJob();

    // Pick up new and edited events every couple of minutes. Needed on
    // localhost, where Google can't deliver webhooks.
    startAutoSync();
  }

  app.listen(PORT, () => {
    console.log(`Calendar Grouper backend listening on :${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
