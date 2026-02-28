#!/usr/bin/env bash
set -euo pipefail

echo "╔══════════════════════════════════════════╗"
echo "║   kYUte 24/7 Yield Guardian (Simulator)  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Adjust this if your directory structure is different
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRE_DIR="${ROOT_DIR}/../cre-workflow"

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
# Note: Boros fetcher was removed from the new spec as we read from subgraph directly,
# so we can skip booting the sidecar in this demo.
echo "[1/2] Skipping legacy Boros Fetcher sidecar..."
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

    # Run the native CRE simulator on the new workflow
    # It points to the kyute-funding-hedge folder that implements the new v1.0 spec
    cre workflow simulate ./kyute-funding-hedge --target=staging-settings

    echo ""
    echo "Workflow complete."
    sleep 30
done