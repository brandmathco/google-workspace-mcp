#!/bin/bash
# Double-click this file on macOS to open the guided setup wizard.
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "Google Workspace MCP — Setup Wizard"
echo "===================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "1) Open https://nodejs.org"
  echo "2) Download the LTS installer and run it"
  echo "3) Double-click this file again"
  echo ""
  open "https://nodejs.org" 2>/dev/null || true
  read -r -p "Press Enter to close…"
  exit 1
fi

MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$MAJOR" -lt 20 ]; then
  echo "Node.js 20+ is required. You have $(node -v)."
  open "https://nodejs.org" 2>/dev/null || true
  read -r -p "Press Enter to close…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install
fi

echo "Starting wizard…"
npx --yes tsx setup/wizard-server.ts
