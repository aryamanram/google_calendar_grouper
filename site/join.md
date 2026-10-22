---
title: Join
description: Connect Calendar Grouper to the backend someone invited you to.
aside: false
outline: false
editLink: false
lastUpdated: false
sidebar: false
---

<script setup>
import { ref, onMounted, onUnmounted } from "vue";

// join.js in the extension marks this page (data-calendar-grouper on <html>)
// and fires a "calendar-grouper" event: installed, connected or error.
const state = ref("checking");
const error = ref("");
const host = ref("");
const hasInvite = ref(true);
const link = ref("");
const copied = ref(false);

function apply(detail) {
  if (detail.state === "installed") return; // keep waiting for the result
  state.value = detail.state;
  if (detail.error) error.value = detail.error;
}
function onEvent(e) {
  apply(e.detail || {});
}

onMounted(() => {
  readInvite();
  window.addEventListener("hashchange", readInvite);
  window.addEventListener("calendar-grouper", onEvent);
  // The extension may have answered before this page rendered.
  const current = document.documentElement.dataset.calendarGrouper;
  if (current) {
    let detail = {};
    try {
      detail = JSON.parse(document.documentElement.dataset.calendarGrouperDetail || "{}");
    } catch {}
    apply({ ...detail, state: current });
  }
  // No word from the extension after a moment: it isn't installed.
  setTimeout(() => {
    if (state.value === "checking") state.value = installed() ? "checking" : "missing";
  }, 1500);
});
onUnmounted(() => {
  window.removeEventListener("calendar-grouper", onEvent);
  window.removeEventListener("hashchange", readInvite);
});

function installed() {
  return !!document.documentElement.dataset.calendarGrouper;
}

function readInvite() {
  link.value = location.href;
  const backend = new URLSearchParams(location.hash.slice(1)).get("backend");
  hasInvite.value = !!backend;
  try {
    host.value = backend ? new URL(backend).host : "";
  } catch {
    hasInvite.value = false;
  }
}

async function copyLink() {
  await navigator.clipboard.writeText(link.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

# Join Calendar Grouper

<div v-if="!hasInvite" class="join-card">
  <p>This page is for invite links. Ask the person who runs your Calendar Grouper backend to send you theirs: they can copy it from the extension, under <strong>People with access</strong>.</p>
</div>

<div v-else-if="state === 'connected'" class="join-card ok">
  <p class="join-status">✓ Connected to <strong>{{ host }}</strong></p>
  <p>One step left: click the <strong>Calendar Grouper</strong> icon in Chrome's toolbar (it may be under the puzzle-piece menu), then <strong>Sign in with Google</strong>.</p>
  <p class="join-note">If Google says the app isn't verified, click <strong>Advanced</strong>, then <strong>Go to Calendar Grouper</strong>. It's normal for a privately hosted copy.</p>
</div>

<div v-else-if="state === 'pending'" class="join-card">
  <p class="join-status">Confirm in the extension</p>
  <p>Your extension is already connected to another backend. Click the <strong>Calendar Grouper</strong> icon in Chrome's toolbar and choose <strong>Switch</strong> to use <strong>{{ host }}</strong> instead, or <strong>Keep current</strong>.</p>
</div>

<div v-else-if="state === 'error'" class="join-card bad">
  <p class="join-status">Couldn't connect</p>
  <p>{{ error }}</p>
</div>

<div v-else-if="state === 'missing'" class="join-card">
  <p>You've been invited to share your calendars through <strong>{{ host }}</strong>.</p>
  <ol>
    <li><a href="/guide/install" target="_blank">Install the Calendar Grouper extension</a> for Chrome.</li>
    <li>Come back to this page and reload it. The extension connects by itself.</li>
  </ol>
  <p class="join-note">Already installed? Click the extension's icon and paste this link: <button class="join-copy" @click="copyLink">{{ copied ? "Copied" : "Copy invite link" }}</button></p>
</div>

<div v-else class="join-card">
  <p>Connecting…</p>
</div>

## What happens next

- You sign in with your own Google account. The extension doesn't show your calendars to the person who invited you, but their backend holds your Google sign-in, so join only if you trust them.
- You pick which of your calendars to combine, and share the result with whoever you like.
- See [Using Calendar Grouper](/guide/using) for the details.

<style>
.join-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 4px 20px;
  margin: 16px 0 24px;
}
.join-card.ok {
  border-color: #34a853;
  background: rgba(52, 168, 83, 0.06);
}
.join-card.bad {
  border-color: #d93025;
  background: rgba(217, 48, 37, 0.06);
}
.join-status {
  font-size: 18px;
  font-weight: 500;
}
.join-note {
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.join-copy {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  cursor: pointer;
}
</style>
