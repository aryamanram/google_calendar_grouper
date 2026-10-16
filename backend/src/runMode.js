// ---------------------------------------------------------------------------
// Where the backend is running
//
// local (default): your laptop. Auto-sync runs on a timer inside the process,
//   and slow work (first copy, updates) runs in the background after replying.
//
// cloud: Cloud Run. Cloud Run only gives the container CPU while it is
//   answering a request, so timers and after-the-reply work would freeze.
//   Instead, Cloud Scheduler calls POST /internal/tick every couple of
//   minutes, and slow work finishes before the request replies.
// ---------------------------------------------------------------------------
const RUN_MODE = process.env.RUN_MODE === "cloud" ? "cloud" : "local";

module.exports = {
  RUN_MODE,
  IS_CLOUD: RUN_MODE === "cloud",
};
