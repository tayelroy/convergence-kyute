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
KYUTE_STAGING_CONFIG="${CRE_DIR}/kyute-agent/config.staging.json"
FRONTEND_ENV_LOCAL="${ROOT_DIR}/../frontend/.env.local"
ANVIL_DEPLOYER="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
DEFAULT_FORK_URL="https://arb1.arbitrum.io/rpc"
DEMO_USER_ID_DEFAULT=123
DEFAULT_YU_TOKEN="0x0000000000000000000000000000000000000001"

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

# Force deterministic local-key signing for demo scripts.
# Keystore mode can silently switch sender/account resolution and break local runs.
unset ETH_KEYSTORE_ACCOUNT
unset ETH_FROM

if [ -z "${PRIVATE_KEY:-}" ] && [ -n "${ANVIL_PRIVATE_KEY:-}" ]; then
    export PRIVATE_KEY="${ANVIL_PRIVATE_KEY}"
fi

if [ -z "${CRE_SIM_PRIVATE_KEY:-}" ] && [ -n "${PRIVATE_KEY:-}" ]; then
    export CRE_SIM_PRIVATE_KEY="${PRIVATE_KEY}"
fi

if [ -z "${CRE_CALLBACK_SIGNER:-}" ] && [ -n "${CRE_SIM_PRIVATE_KEY:-}" ] && command -v cast >/dev/null 2>&1; then
    derived_signer=$(cast wallet address --private-key "${CRE_SIM_PRIVATE_KEY}" 2>/dev/null || true)
    if [ -n "${derived_signer}" ]; then
        export CRE_CALLBACK_SIGNER="${derived_signer}"
    fi
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
    if [ -n "${CRE_CALLBACK_SIGNER:-}" ]; then
        echo "   • CRE_CALLBACK_SIGNER not in .env; using derived CRE signer ${CRE_CALLBACK_SIGNER}."
    else
        echo "   • CRE_CALLBACK_SIGNER not set; defaulting to Anvil deployer ${ANVIL_DEPLOYER}."
    fi
fi
echo "   ✓ Required deployment env vars found."
echo ""

FORK_URL="${FORK_URL:-${RPC_URL:-${DEFAULT_FORK_URL}}}"
DEMO_RPC_URL="${DEMO_RPC_URL:-http://localhost:8545}"
FORK_BLOCK_NUMBER="${FORK_BLOCK_NUMBER:-}"
DEMO_NO_FORK="${DEMO_NO_FORK:-true}"
DEMO_USER_ID="${DEMO_USER_ID:-${DEMO_USER_ID_DEFAULT}}"
DEMO_EXEC_MODE="${DEMO_EXEC_MODE:-direct}"
export ANVIL_RPC_URL="${DEMO_RPC_URL}"
ANVIL_PORT="${ANVIL_PORT:-8545}"

# ── 2. Boot Local Arbitrum Fork ───────────────────
stop_existing_anvil_on_port() {
    local pids
    pids=$(lsof -ti "tcp:${ANVIL_PORT}" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "${pids}" ]; then
        echo "   • Port ${ANVIL_PORT} already in use. Stopping existing process(es): ${pids}"
        kill ${pids} 2>/dev/null || true
        sleep 1
    fi
}

echo "[1/4] Starting local Anvil chain..."
stop_existing_anvil_on_port
if [ "${DEMO_NO_FORK}" = "true" ]; then
    echo "   • mode=no-fork (fully local deterministic demo chain)"
    anvil --port "${ANVIL_PORT}" > /tmp/kyute_anvil.log 2>&1 &
else
    echo "   • mode=fork"
    if [ -n "${FORK_BLOCK_NUMBER}" ]; then
        echo "   • fork_url=${FORK_URL}"
        echo "   • fork_block_number=${FORK_BLOCK_NUMBER}"
        anvil --port "${ANVIL_PORT}" --fork-url "${FORK_URL}" --fork-block-number "${FORK_BLOCK_NUMBER}" > /tmp/kyute_anvil.log 2>&1 &
    else
        echo "   • fork_url=${FORK_URL}"
        anvil --port "${ANVIL_PORT}" --fork-url "${FORK_URL}" > /tmp/kyute_anvil.log 2>&1 &
    fi
fi
ANVIL_PID=$!
sleep 3
if ! kill -0 "${ANVIL_PID}" 2>/dev/null; then
    echo "   ✗ Anvil failed to start. Last lines from /tmp/kyute_anvil.log:"
    tail -n 40 /tmp/kyute_anvil.log || true
    exit 1
fi
echo "   ✓ Anvil running (PID: ${ANVIL_PID})"
echo ""

forge_broadcast_cmd() {
    local script_target="$1"
    local log_file="$2"
    cd "${CONTRACTS_DIR}"
    if [ -n "${ANVIL_PRIVATE_KEY:-}" ]; then
        forge script "${script_target}" --rpc-url "${DEMO_RPC_URL}" --private-key "${ANVIL_PRIVATE_KEY}" --broadcast --skip-simulation > "${log_file}" 2>&1
    else
        forge script "${script_target}" --rpc-url "${DEMO_RPC_URL}" --unlocked --sender "${ANVIL_DEPLOYER}" --broadcast --skip-simulation > "${log_file}" 2>&1
    fi
}

upsert_env_var() {
    local file="$1"
    local key="$2"
    local value="$3"

    if [ ! -f "${file}" ]; then
        touch "${file}"
    fi

    if grep -Eq "^${key}=" "${file}"; then
        perl -i -pe "s|^${key}=.*$|${key}=${value}|g" "${file}"
    else
        echo "${key}=${value}" >> "${file}"
    fi
}

sync_frontend_demo_env() {
    upsert_env_var "${FRONTEND_ENV_LOCAL}" "NEXT_PUBLIC_DEMO_MODE" "true"
    upsert_env_var "${FRONTEND_ENV_LOCAL}" "ANVIL_RPC_URL" "${DEMO_RPC_URL}"
    upsert_env_var "${FRONTEND_ENV_LOCAL}" "BOROS_ROUTER_ADDRESS" "${BOROS_ROUTER_ADDRESS}"
    upsert_env_var "${FRONTEND_ENV_LOCAL}" "BOROS_YU_TOKEN" "${DEFAULT_YU_TOKEN}"
    echo "   ✓ Synced frontend demo env at ${FRONTEND_ENV_LOCAL}"
}

deploy_mock_router() {
    echo "   • BOROS_ROUTER_ADDRESS not set; deploying MockBorosRouter to local fork..."
    if ! forge_broadcast_cmd "script/DeployMockBorosRouter.s.sol:DeployMockBorosRouter" "/tmp/kyute_mock_router.log"; then
        echo "     ✗ Mock router deployment failed."
        echo "       Showing last 20 lines from /tmp/kyute_mock_router.log:"
        tail -n 20 /tmp/kyute_mock_router.log
        exit 1
    fi
    local addr
    addr=$(grep -Eo "Deployed to: 0x[0-9a-fA-F]{40}" /tmp/kyute_mock_router.log | tail -n1 | awk '{print $3}' || true)
    if [ -z "${addr}" ]; then
        # Fallback: grab the last address-looking token from the deploy log.
        addr=$(grep -Eo "0x[0-9a-fA-F]{40}" /tmp/kyute_mock_router.log | tail -n1 || true)
    fi
    if [ -z "${addr}" ]; then
        echo "     ✗ Could not parse mock router address from deploy log."
        echo "       Showing last 30 lines from /tmp/kyute_mock_router.log:"
        tail -n 30 /tmp/kyute_mock_router.log || true
        exit 1
    fi
    export BOROS_ROUTER_ADDRESS="${addr}"
    echo "   ✓ Mock Boros router deployed at ${BOROS_ROUTER_ADDRESS}"
}

deploy_mock_collateral() {
    echo "   • Deploying MockCollateralToken for local demo..."
    if ! forge_broadcast_cmd "script/DeployMockCollateralToken.s.sol:DeployMockCollateralToken" "/tmp/kyute_mock_collateral.log"; then
        echo "     ✗ Mock collateral deployment failed."
        echo "       Showing last 20 lines from /tmp/kyute_mock_collateral.log:"
        tail -n 20 /tmp/kyute_mock_collateral.log
        exit 1
    fi
    local addr
    addr=$(grep -Eo "Deployed to: 0x[0-9a-fA-F]{40}" /tmp/kyute_mock_collateral.log | tail -n1 | awk '{print $3}' || true)
    if [ -z "${addr}" ]; then
        addr=$(grep -Eo "0x[0-9a-fA-F]{40}" /tmp/kyute_mock_collateral.log | tail -n1 || true)
    fi
    if [ -z "${addr}" ]; then
        echo "     ✗ Could not parse mock collateral address from deploy log."
        echo "       Showing last 30 lines from /tmp/kyute_mock_collateral.log:"
        tail -n 30 /tmp/kyute_mock_collateral.log || true
        exit 1
    fi
    export BOROS_COLLATERAL_ADDRESS="${addr}"
    echo "   ✓ Mock collateral deployed at ${BOROS_COLLATERAL_ADDRESS}"
}

seed_demo_state() {
    if [ -z "${ANVIL_PRIVATE_KEY:-}" ]; then
        echo "   • ANVIL_PRIVATE_KEY missing; skipping automatic vault seed/map."
        return
    fi
    local demo_user
    demo_user=$(cast wallet address --private-key "${ANVIL_PRIVATE_KEY}" 2>/dev/null || true)
    if [ -z "${demo_user}" ]; then
        echo "   • Could not derive demo user from ANVIL_PRIVATE_KEY; skipping seed/map."
        return
    fi

    echo "   • Seeding vault TVL + mapping userId=${DEMO_USER_ID} to ${demo_user}..."
    cast send "${BOROS_COLLATERAL_ADDRESS}" "mint(address,uint256)" "${demo_user}" 1000000000000000000000 --private-key "${ANVIL_PRIVATE_KEY}" --rpc-url "${DEMO_RPC_URL}" >/tmp/kyute_seed_mint.log 2>&1 || true
    cast send "${BOROS_COLLATERAL_ADDRESS}" "approve(address,uint256)" "${VAULT_ADDRESS}" 1000000000000000000000 --private-key "${ANVIL_PRIVATE_KEY}" --rpc-url "${DEMO_RPC_URL}" >/tmp/kyute_seed_approve.log 2>&1 || true
    cast send "${VAULT_ADDRESS}" "deposit(uint256,address)" 100000000000000000000 "${demo_user}" --private-key "${ANVIL_PRIVATE_KEY}" --rpc-url "${DEMO_RPC_URL}" >/tmp/kyute_seed_deposit.log 2>&1 || true
    cast send "${VAULT_ADDRESS}" "openHyperliquidPosition(bytes,uint256,address,bool,uint256,uint256)" 0x "${DEMO_USER_ID}" "${BOROS_COLLATERAL_ADDRESS}" true 1000000000000000000 1 --private-key "${ANVIL_PRIVATE_KEY}" --rpc-url "${DEMO_RPC_URL}" >/tmp/kyute_seed_map.log 2>&1 || true
    echo "   ✓ Seed/map attempted (logs: /tmp/kyute_seed_*.log)"
}

# In no-fork mode we always deploy local collateral token.
if [ "${DEMO_NO_FORK}" = "true" ]; then
    deploy_mock_collateral
fi

# If no router address provided, deploy a mock to the fork.
if [ -z "${BOROS_ROUTER_ADDRESS:-}" ] || [ "${BOROS_ROUTER_ADDRESS}" = "0x0000000000000000000000000000000000000000" ]; then
    deploy_mock_router
fi
sync_frontend_demo_env

# ── 3. Deploy kYUteVault ──────────────────────────
echo "[2/4] Deploying kYUteVault to local fork..."
if ! forge_broadcast_cmd "script/DeployKyuteVault.s.sol:DeployKyuteVault" "/tmp/kyute_deploy.log"; then
    echo "   ✗ Contract deployment failed."
    echo "     Showing last 20 lines from /tmp/kyute_deploy.log:"
    tail -n 20 /tmp/kyute_deploy.log
    exit 1
fi
DEPLOY_RUN_JSON=$(ls -t "${CONTRACTS_DIR}"/broadcast/DeployKyuteVault.s.sol/*/run-latest.json 2>/dev/null | head -n1 || true)
if [ -z "${DEPLOY_RUN_JSON}" ] || [ ! -f "${DEPLOY_RUN_JSON}" ]; then
    echo "   ✗ Missing deploy output JSON under ${CONTRACTS_DIR}/broadcast/DeployKyuteVault.s.sol/*/run-latest.json"
    exit 1
fi

VAULT_ADDRESS=$(grep -m1 -Eo '"contractAddress": "0x[0-9a-fA-F]{40}"' "${DEPLOY_RUN_JSON}" | sed -E 's/.*"(0x[0-9a-fA-F]{40})"/\1/' || true)
if [ -z "${VAULT_ADDRESS:-}" ]; then
    echo "   ✗ Could not parse kYUteVault address from ${DEPLOY_RUN_JSON}"
    exit 1
fi
echo "   ✓ kYUteVault deployed at ${VAULT_ADDRESS}"
echo "   • deploy metadata: ${DEPLOY_RUN_JSON}"
export KYUTE_VAULT_ADDRESS="${VAULT_ADDRESS}"
export BOROS_YU_TOKEN="${DEFAULT_YU_TOKEN}"
export DEMO_USER_ID
export DEMO_SHOULD_HEDGE="${DEMO_SHOULD_HEDGE:-true}"
export DEMO_HEDGE_NOTIONAL_WEI="${DEMO_HEDGE_NOTIONAL_WEI:-1000000000000000000}"

if [ -f "${KYUTE_STAGING_CONFIG}" ]; then
    if command -v node >/dev/null 2>&1; then
        node -e '
            const fs = require("fs");
            const path = process.argv[1];
            const vaultAddress = process.argv[2];
            const json = JSON.parse(fs.readFileSync(path, "utf8"));
            json.vaultAddress = vaultAddress;
            fs.writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
        ' "${KYUTE_STAGING_CONFIG}" "${VAULT_ADDRESS}"
        echo "   ✓ Updated ${KYUTE_STAGING_CONFIG} with deployed vaultAddress"
    else
        echo "   • node not found; skipping automatic staging config update."
    fi
fi
echo "   ✓ Contracts deployed."
seed_demo_state
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
echo "[4/4] Starting Hedge Execution Loop..."
echo "   • mode=${DEMO_EXEC_MODE}"
echo "   Press Ctrl+C at any time to safely shut down."
echo ""

while true; do
    echo "======================================================"
    echo "[$(date +'%T')] Triggering CRE Execution..."
    echo "======================================================"

    if [ "${DEMO_EXEC_MODE}" = "cre" ]; then
        cre workflow simulate ./kyute-agent --target=staging-settings
    else
        bun run direct-hedge-cycle.ts
    fi

    echo ""
    echo "Workflow complete. Waiting 30s..."
    sleep 30
done
