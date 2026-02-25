#!/usr/bin/env bash
set -euo pipefail

echo "╔══════════════════════════════════════════╗"
echo "║   kYUte 24/7 Yield Guardian (Simulator)  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Adjust this if your directory structure is different
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRE_DIR="${ROOT_DIR}/../cre-kyute"

# ── 1. Clean Shutdown Trap ────────────────────────
cleanup() {
    echo ""
    echo "Stopping kYUte Agent..."
    if [ -n "${FETCHER_PID:-}" ]; then
        kill "${FETCHER_PID}" 2>/dev/null || true
        echo "   ✓ Boros fetcher sidecar stopped."
    fi
    exit 0
}
# Trap Ctrl+C (INT) and termination signals (TERM)
trap cleanup INT TERM

cd "${CRE_DIR}"

# ── 2. Boot the Data Sidecar ──────────────────────
echo "[1/2] Booting Boros Fetcher sidecar..."
bun run boros-fetcher.ts &
FETCHER_PID=$!
echo "   ✓ Sidecar running in background (PID: ${FETCHER_PID})"
echo ""

# Give the sidecar 5 seconds to complete its first fetch and populate Supabase
echo "Waiting 5 seconds for initial Supabase data population..."
sleep 5
echo ""

# ── 3. The 24/7 Execution Loop ────────────────────
echo "[2/2] Starting CRE Workflow Consensus Loop..."
echo "   Press Ctrl+C at any time to safely shut down."
echo ""

while true; do
    echo "======================================================"
    echo "[$(date +'%T')] Triggering CRE Execution..."
    echo "======================================================"

    # Run the native CRE simulator. 
    # The --broadcast flag ensures EVMClient transactions actually fire!
    cre workflow simulate ./kyute-agent --target=staging-settings --broadcast

    echo ""
    echo "Workflow complete."
    sleep 30
done