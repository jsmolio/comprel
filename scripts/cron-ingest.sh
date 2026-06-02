#!/bin/bash
# Incremental ingest for the launchd schedule. launchd runs with a minimal
# environment, so set PATH explicitly (homebrew pnpm + pnpm-managed node).
export PATH="/opt/homebrew/bin:$HOME/.local/share/pnpm:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.." || exit 1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') : comprel incremental ingest ==="
pnpm ingest --incremental
echo "=== done ==="
