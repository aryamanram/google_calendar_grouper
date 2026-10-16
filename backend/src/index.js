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
const { startAutoSync } = require("./services/autoSync");

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
app.use("/auth", authRoutes);
app.use("/groups", groupRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/share", shareRoutes);

// Health check — Cloud Run pings this
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  await initFirestore();

  // Renew expiring watch channels once per hour
  startWatchRenewalJob();

  // Pick up new and edited events every couple of minutes. Needed on
  // localhost, where Google can't deliver webhooks; a safety net once deployed.
  startAutoSync();

  app.listen(PORT, () => {
    console.log(`Calendar Grouper backend listening on :${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
