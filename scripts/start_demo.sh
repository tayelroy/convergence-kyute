#!/usr/bin/env bash
set -euo pipefail

echo "╔══════════════════════════════════════════╗"
echo "║   kYUte 24/7 Yield Guardian (Simulator)  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Adjust this if your directory structure is different
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRE_DIR="${ROOT_DIR}/../cre-kyute"
CONTRACTS_DIR="${ROOT_DIR}/../contracts"

# ── 1. Clean Shutdown Trap ────────────────────────
cleanup() {
    echo ""
    echo "Stopping kYUte E2E Demo..."
    if [ -n "${ANVIL_PID:-}" ]; then
        kill "${ANVIL_PID}" 2>/dev/null || true
        echo "   ✓ Anvil fork stopped."
    fi
    if [ -n "${FETCHER_PID:-}" ]; then
        kill "${FETCHER_PID}" 2>/dev/null || true
        echo "   ✓ Telemetry fetcher stopped."
    fi
    exit 0
}
trap cleanup INT TERM

# ── 2. Boot Local Arbitrum Fork ───────────────────
echo "[1/4] Starting local Arbitrum Fork (Anvil)..."
anvil --fork-url https://arb1.arbitrum.io/rpc > /dev/null 2>&1 &
ANVIL_PID=$!
sleep 3
echo "   ✓ Anvil running (PID: ${ANVIL_PID})"
echo ""

# ── 3. Deploy kYUteVault ──────────────────────────
echo "[2/4] Deploying kYUteVault to local fork..."
cd "${CONTRACTS_DIR}"
forge script script/DeployKyuteVault.s.sol:DeployKyuteVault --fork-url http://localhost:8545 --broadcast > /dev/null 2>&1
echo "   ✓ Contracts deployed."
echo ""

# ── 4. Boot the Telemetry Sidecar ─────────────────
echo "[3/4] Booting Supabase Telemetry sidecar..."
cd "${CRE_DIR}"
bun run boros-fetcher.ts > /dev/null 2>&1 &
FETCHER_PID=$!
echo "   ✓ Sidecar running in background (PID: ${FETCHER_PID})"
echo "Waiting 5 seconds for initial Supabase data population..."
sleep 5
echo ""

# ── 5. The 24/7 Execution Loop ────────────────────
echo "[4/4] Starting CRE Workflow Consensus Loop..."
echo "   Press Ctrl+C at any time to safely shut down."
echo ""

while true; do
    echo "======================================================"
    echo "[$(date +'%T')] Triggering CRE Execution..."
    echo "======================================================"

    cre workflow simulate ./kyute-agent --target=staging-settings

    echo ""
    echo "Workflow complete. Waiting 30s..."
    sleep 30
done