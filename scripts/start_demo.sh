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
CONTRACTS_ENV_FILE="${CONTRACTS_DIR}/.env"
ANVIL_DEPLOYER="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"

require_dotenv_var() {
    local key="$1"
    if ! grep -Eq "^${key}=" "${CONTRACTS_ENV_FILE}"; then
        echo "   ✗ Missing ${key} in ${CONTRACTS_ENV_FILE}"
        return 1
    fi
}

has_dotenv_var() {
    local key="$1"
    grep -Eq "^${key}=" "${CONTRACTS_ENV_FILE}"
}

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

if [ ! -f "${CONTRACTS_ENV_FILE}" ]; then
    echo "   ✗ Missing ${CONTRACTS_ENV_FILE}."
    echo "     Create it from your sample env and set deploy values before running the demo."
    exit 1
fi

set -a
source "${CONTRACTS_ENV_FILE}"
set +a

if [ -z "${PRIVATE_KEY:-}" ] && [ -n "${ANVIL_PRIVATE_KEY:-}" ]; then
    export PRIVATE_KEY="${ANVIL_PRIVATE_KEY}"
fi

if [ -z "${CRE_SIM_PRIVATE_KEY:-}" ] && [ -n "${PRIVATE_KEY:-}" ]; then
    export CRE_SIM_PRIVATE_KEY="${PRIVATE_KEY}"
fi

if [ -z "${CRE_SUPABASE_KEY:-}" ] && [ -n "${SUPABASE_KEY:-}" ]; then
    export CRE_SUPABASE_KEY="${SUPABASE_KEY}"
fi

if [ -z "${CRE_GEMINI_API_KEY:-}" ] && [ -n "${GEMINI_API_KEY:-}" ]; then
    export CRE_GEMINI_API_KEY="${GEMINI_API_KEY}"
fi

echo "Checking required deployment env vars..."
require_dotenv_var "BOROS_ROUTER_ADDRESS"
require_dotenv_var "BOROS_COLLATERAL_ADDRESS"
if ! has_dotenv_var "CRE_CALLBACK_SIGNER"; then
    echo "   • CRE_CALLBACK_SIGNER not set; defaulting to Anvil deployer ${ANVIL_DEPLOYER}."
fi
echo "   ✓ Required deployment env vars found."
echo ""

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
if ! forge script script/DeployKyuteVault.s.sol:DeployKyuteVault --fork-url http://localhost:8545 --unlocked --sender "${ANVIL_DEPLOYER}" --broadcast > /tmp/kyute_deploy.log 2>&1; then
    echo "   ✗ Contract deployment failed."
    echo "     Showing last 20 lines from /tmp/kyute_deploy.log:"
    tail -n 20 /tmp/kyute_deploy.log
    exit 1
fi
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