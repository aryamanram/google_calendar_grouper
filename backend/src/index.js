require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const groupRoutes = require("./routes/groups");
const webhookRoutes = require("./routes/webhooks");
const shareRoutes = require("./routes/share");
const peopleRoutes = require("./routes/people");
const { initFirestore } = require("./models/firestore");
const { startWatchRenewalJob } = require("./services/watchManager");
const { startAutoSync, pollOnce } = require("./services/autoSync");
const { requireSession, requireOwner, requireTickSecret } = require("./middleware/auth");
const { IS_CLOUD, RUN_MODE } = require("./runMode");
const { allowedEmails, extensionIds } = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(
  cors({
    // Requests are authorized by the session token, not by where they come
    // from, so any copy of the extension may call the backend. EXTENSION_ID,
    // if set, narrows this to the listed copies.
    origin(origin, callback) {
      const ids = extensionIds();
      const ok =
        !origin || // not a browser request (curl, Cloud Scheduler)
        origin === "http://localhost:5173" || // Vite dev server for the popup
        (origin.startsWith("chrome-extension://") &&
          (ids.length === 0 || ids.includes(origin.slice("chrome-extension://".length))));
      callback(null, ok);
    },
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
// /auth/login and /auth/callback are opened in a browser window, so they
// can't send a token; the other /auth routes check it themselves.
app.use("/auth", authRoutes);
app.use("/groups", requireSession, groupRoutes);
app.use("/share", requireSession, shareRoutes);
app.use("/people", requireSession, requireOwner, peopleRoutes);
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

// Health check. "app" lets the extension confirm an address really is a
// Calendar Grouper backend before saving it.
app.get("/health", (_req, res) => res.json({ status: "ok", mode: RUN_MODE, app: "calendar-grouper" }));

// Unexpected errors: log them, and answer with JSON the popup can show.
// Client mistakes (malformed JSON, a body that's too large) keep their 4xx.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    console.error("Request failed:", err);
    return res.status(500).json({ error: "Something went wrong on the backend. Try again." });
  }
  res.status(status).json({ error: "The request was not valid." });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  if (IS_CLOUD) {
    const missing = ["TICK_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI"].filter((k) => !process.env[k]?.trim());
    // ALLOWED_EMAILS names the owners. Without it, any Google account could sign in.
    if (allowedEmails().length === 0) missing.push("ALLOWED_EMAILS");
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
