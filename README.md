# Calendar Grouper

A Chrome Extension + backend service that lets you group multiple Google Calendars into a single shareable calendar. The recipient gets one toggleable calendar containing your full schedule — no need to share each calendar individually.

## Architecture

```
┌─────────────────────┐       ┌──────────────────────┐       ┌─────────────────┐
│  Chrome Extension    │──────▶│  Cloud Run Backend    │──────▶│  Google Calendar │
│  (Manifest V3 +     │  API  │  (Node/Express)       │  API  │  API v3         │
│   React popup)       │◀──────│                       │◀──────│                 │
└─────────────────────┘       │  ┌──────────────────┐ │       └─────────────────┘
                              │  │ Webhook endpoint │◀─────── Google Push Notifications
                              │  └──────────────────┘ │
                              │  ┌──────────────────┐ │
                              │  │ Firestore        │ │
                              │  │ - sync config    │ │
                              │  │ - event mappings │ │
                              │  │ - OAuth tokens   │ │
                              │  └──────────────────┘ │
                              └──────────────────────┘
```

## Setup

### Prerequisites
- Node.js 20+
- Google Cloud project with Calendar API enabled
- Firebase/Firestore project
- Chrome browser (for extension development)

### 1. Google Cloud Console
1. Create a project at https://console.cloud.google.com
2. Enable the Google Calendar API
3. Create OAuth 2.0 credentials (Web Application type)
4. Add `https://your-app.run.app/auth/callback` to authorized redirect URIs
5. Add `chrome-extension://<your-extension-id>` to authorized JavaScript origins

### 2. Backend
```bash
cd backend
cp .env.example .env
# Fill in your Google Cloud credentials
npm install
npm run dev
```

### 3. Extension
```bash
cd extension/popup
npm install
npm run build
```
Then load the `extension/` folder as an unpacked extension in `chrome://extensions`.

## Project Structure
```
calendar-grouper/
├── extension/              Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js       Service worker — auth token relay
│   ├── popup/              React app for the config UI
│   │   ├── src/
│   │   │   ├── App.jsx
│   │   │   ├── index.jsx
│   │   │   └── components/
│   │   ├── public/
│   │   └── package.json
│   └── assets/
│       └── icon128.png
├── backend/                Node/Express on Cloud Run
│   ├── src/
│   │   ├── index.js        Express entry point
│   │   ├── routes/
│   │   │   ├── auth.js     OAuth 2.0 flow
│   │   │   ├── groups.js   CRUD for calendar groups
│   │   │   ├── webhooks.js Google push notification receiver
│   │   │   └── share.js    Manage sharing / ACLs
│   │   ├── services/
│   │   │   ├── calendarSync.js   Core sync engine
│   │   │   ├── watchManager.js   Watch channel lifecycle
│   │   │   └── googleApi.js      Calendar API wrapper
│   │   └── models/
│   │       └── firestore.js      Firestore helpers
│   ├── Dockerfile
│   ├── .env.example
│   └── package.json
└── README.md
```
