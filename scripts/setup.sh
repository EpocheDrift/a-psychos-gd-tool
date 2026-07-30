#!/usr/bin/env bash
# One-shot setup: checks the reference Node version, installs the exact locked
# dependencies, and verifies the bundled font. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

# CI and local development use Node 22.12 or newer.
node_version="$(node --version 2>/dev/null)" || {
  echo "error: node not found — install Node.js 22.12 or newer" >&2
  exit 1
}
major="${node_version#v}"; major="${major%%.*}"
minor="${node_version#v*.}"; minor="${minor%%.*}"
if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 12 ]; }; then
  echo "error: Node $node_version is unsupported — install Node.js 22.12 or newer" >&2
  exit 1
fi
echo "node $node_version ok"

node scripts/check-font.mjs

npm ci

echo
echo "setup complete — run 'npm run dev' and open the printed URL in a WebGPU browser (Chrome/Edge 113+ or Safari 18+)"
