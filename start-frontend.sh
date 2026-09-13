#!/bin/bash
# Robust frontend launcher.
# Pins Next.js to port 3000 and auto-restarts on crash.
#
# Why this exists: `next dev` can die while its child `next-server` survives and
# keeps holding port 3000. The next instance then silently falls back to 3003.
# This script clears any stale process on 3000 before every start and forces -p 3000.

cd "$(dirname "$0")/extraction-script"

while true; do
    echo "[frontend] clearing stale processes on port 3000..."

    # Kill leftover next dev / next-server processes from previous runs
    pkill -f "extraction-script.*/node_modules/.bin/next dev" 2>/dev/null
    pkill -f "next-server (v" 2>/dev/null

    # Free the port if anything still holds it
    fuser -k 3000/tcp 2>/dev/null

    sleep 1

    echo "[frontend] starting next dev on port 3000..."
    npm run dev -- -p 3000
    echo "[frontend] next dev exited (code $?). Restarting in 2s..."
    sleep 2
done