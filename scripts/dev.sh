#!/usr/bin/env bash
# Starts the API and the app together, repairing the two things a sandbox
# restart breaks: installed dependencies (node_modules is not snapshotted) and
# a wiped dev database (recreated and seeded by the server on boot).
set -e
cd "$(dirname "$0")/.."

if [ ! -x node_modules/.bin/tsx ] || [ ! -x node_modules/.bin/vite ]; then
  echo "[dev] dependencies missing — installing…"
  npm install --silent
fi

npm run server &
API=$!
npm run dev &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' INT TERM

echo "[dev] API on :8787, app on :5173 — Ctrl-C to stop"
wait -n $API $WEB
