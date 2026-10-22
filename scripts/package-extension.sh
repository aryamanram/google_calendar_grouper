#!/usr/bin/env bash
# Builds the popup and zips the extension for the Chrome Web Store or a
# GitHub release. Output: dist/calendar-grouper-<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

(cd extension/popup && npm ci --silent && npm run build --silent) >&2

VERSION=$(node -p "require('./extension/manifest.json').version")
OUT="dist/calendar-grouper-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"

# Only what Chrome loads: no sources, no node_modules.
(cd extension && zip -qr "../$OUT" manifest.json background.js join.js assets popup/dist)

echo "$OUT"
unzip -l "$OUT" | tail -n +4 | head -n -2 >&2
