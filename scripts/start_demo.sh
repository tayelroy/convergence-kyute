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
DEMO_POSITION_NOTIONAL_WEI_DEFAULT=1000000000000000000
KYUTE_AGENT_SIDECAR_URL="${KYUTE_AGENT_SIDECAR_URL:-http://127.0.0.1:8791}"
if [ -z "${KYUTE_AGENT_SIDECAR_PORT:-}" ]; then
    sidecar_port_from_url=$(printf '%s' "${KYUTE_AGENT_SIDECAR_URL}" | sed -E 's#^https?://[^:/]+:([0-9]+).*$#\1#' || true)
    if [[ "${sidecar_port_from_url}" =~ ^[0-9]+$ ]]; then
        export KYUTE_AGENT_SIDECAR_PORT="${sidecar_port_from_url}"
    else
        export KYUTE_AGENT_SIDECAR_PORT="8791"
    fi
fi

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
    if [ -n "${AGENT_SIDECAR_PID:-}" ]; then
        kill "${AGENT_SIDECAR_PID}" 2>/dev/null || true
        echo "   ✓ Agent sidecar stopped."
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

if [ -z "${CRE_SIM_PRIVATE_KEY:-}" ] && [ -n "${ANVIL_PRIVATE_KEY:-}" ]; then
    export CRE_SIM_PRIVATE_KEY="${ANVIL_PRIVATE_KEY}"
elif [ -z "${CRE_SIM_PRIVATE_KEY:-}" ] && [ -n "${PRIVATE_KEY:-}" ]; then
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
DEMO_EXEC_MODE="${DEMO_EXEC_MODE:-cre}"
DEMO_POSITION_NOTIONAL_WEI="${DEMO_POSITION_NOTIONAL_WEI:-${DEMO_POSITION_NOTIONAL_WEI_DEFAULT}}"
DEMO_HL_POSITION_TESTNET="${DEMO_HL_POSITION_TESTNET:-true}"
export ANVIL_RPC_URL="${DEMO_RPC_URL}"
export DEMO_HL_POSITION_TESTNET
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

stop_existing_sidecar_on_port() {
    local port="$1"
    local pids
    pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "${pids}" ]; then
        echo "   • Sidecar port ${port} already in use. Stopping existing process(es): ${pids}"
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
    upsert_env_var "${FRONTEND_ENV_LOCAL}" "NEXT_PUBLIC_KYUTE_RPC_URL" "${DEMO_RPC_URL}"
    upsert_env_var "${FRONTEND_ENV_LOCAL}" "BOROS_ROUTER_ADDRESS" "${BOROS_ROUTER_ADDRESS}"
    upsert_env_var "${FRONTEND_ENV_LOCAL}" "BOROS_COLLATERAL_ADDRESS" "${BOROS_COLLATERAL_ADDRESS}"
    upsert_env_var "${FRONTEND_ENV_LOCAL}" "BOROS_YU_TOKEN" "${DEFAULT_YU_TOKEN}"
    upsert_env_var "${FRONTEND_ENV_LOCAL}" "NEXT_PUBLIC_KYUTE_CHAIN_ID" "31337"
    local canonical_wallet
    canonical_wallet=$(resolve_canonical_demo_wallet || true)
    if [[ "${canonical_wallet}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        upsert_env_var "${FRONTEND_ENV_LOCAL}" "NEXT_PUBLIC_CANONICAL_HL_WALLET" "${canonical_wallet}"
    fi
    echo "   ✓ Synced frontend demo env at ${FRONTEND_ENV_LOCAL}"
}

sync_direct_hl_env() {
    if [ -n "${HL_ADDRESS:-}" ]; then
        export KYUTE_ALLOW_DEMO_HL_ADDRESS="${KYUTE_ALLOW_DEMO_HL_ADDRESS:-true}"
        echo "   ✓ Using explicit HL_ADDRESS=${HL_ADDRESS} for direct hedge sizing"
        return
    fi

    if [ ! -f "${KYUTE_STAGING_CONFIG}" ] || ! command -v node >/dev/null 2>&1; then
        return
    fi

    local staging_hl_address
    staging_hl_address=$(node -e '
        const fs = require("fs");
        const path = process.argv[1];
        const json = JSON.parse(fs.readFileSync(path, "utf8"));
        const hlAddress = typeof json.hlAddress === "string" ? json.hlAddress.trim() : "";
        process.stdout.write(hlAddress);
    ' "${KYUTE_STAGING_CONFIG}" 2>/dev/null || true)

    if [ -n "${staging_hl_address}" ]; then
        export HL_ADDRESS="${staging_hl_address}"
        export KYUTE_ALLOW_DEMO_HL_ADDRESS="${KYUTE_ALLOW_DEMO_HL_ADDRESS:-true}"
        echo "   ✓ Using staging HL wallet ${HL_ADDRESS} for direct hedge sizing"
    fi
}

resolve_canonical_demo_wallet() {
    if [[ "${HL_ADDRESS:-}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        printf '%s' "${HL_ADDRESS}"
        return
    fi

    if [[ "${DEMO_HL_ADDRESS:-}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        printf '%s' "${DEMO_HL_ADDRESS}"
        return
    fi

    if [ -f "${KYUTE_STAGING_CONFIG}" ] && command -v node >/dev/null 2>&1; then
        local staging_hl_address
        staging_hl_address=$(node -e '
            const fs = require("fs");
            const path = process.argv[1];
            const json = JSON.parse(fs.readFileSync(path, "utf8"));
            const hlAddress = typeof json.hlAddress === "string" ? json.hlAddress.trim() : "";
            process.stdout.write(hlAddress);
        ' "${KYUTE_STAGING_CONFIG}" 2>/dev/null || true)

        if [[ "${staging_hl_address}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
            printf '%s' "${staging_hl_address}"
            return
        fi
    fi
}

resolve_supabase_demo_identity() {
    local canonical_wallet
    canonical_wallet=$(resolve_canonical_demo_wallet || true)
    if [[ ! "${canonical_wallet}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        echo "   • No canonical wallet configured for enrollment."
        return 1
    fi

    local supabase_url="${SUPABASE_URL:-}"
    local supabase_key="${CRE_SUPABASE_KEY:-${SUPABASE_KEY:-}}"
    if [ -z "${supabase_url}" ] || [ -z "${supabase_key}" ]; then
        echo "   • Supabase URL/key unavailable; cannot resolve enrollment identity."
        return 1
    fi

    local canonical_wallet_lower
    canonical_wallet_lower=$(printf '%s' "${canonical_wallet}" | tr '[:upper:]' '[:lower:]')
    local query_url="${supabase_url%/}/rest/v1/kyute_user_wallets?select=user_id,wallet_address,expires_at&order=updated_at.desc&limit=1&wallet_address=eq.${canonical_wallet_lower}"
    local response
    if ! response=$(curl -fsS \
        -H "apikey: ${supabase_key}" \
        -H "Authorization: Bearer ${supabase_key}" \
        -H "Accept: application/json" \
        "${query_url}" 2>/tmp/kyute_enroll_supabase.err); then
        echo "   • Failed to query Supabase for canonical wallet ${canonical_wallet}."
        tail -n 5 /tmp/kyute_enroll_supabase.err 2>/dev/null || true
        return 1
    fi

    local identity_line
    identity_line=$(node -e '
        const payload = JSON.parse(process.argv[1]);
        if (!Array.isArray(payload) || payload.length === 0) process.exit(2);
        const row = payload[0] ?? {};
        const userId = Number(row.user_id);
        const wallet = typeof row.wallet_address === "string" ? row.wallet_address.trim().toLowerCase() : "";
        const expiresAt = typeof row.expires_at === "string" ? Date.parse(row.expires_at) : Number.NaN;
        if (!Number.isFinite(userId) || userId <= 0 || !/^0x[0-9a-f]{40}$/.test(wallet)) process.exit(3);
        if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) process.exit(4);
        process.stdout.write(`${userId} ${wallet}`);
    ' "${response}" 2>/tmp/kyute_enroll_identity.err || true)

    if [ -z "${identity_line}" ]; then
        echo "   • No valid Supabase identity row found for canonical wallet ${canonical_wallet}."
        tail -n 5 /tmp/kyute_enroll_identity.err 2>/dev/null || true
        return 1
    fi

    printf '%s' "${identity_line}"
}

enroll_canonical_wallet() {
    if [ -z "${VAULT_ADDRESS:-}" ]; then
        echo "   • Vault address missing; cannot enroll canonical wallet."
        return 1
    fi
    if [ -z "${ANVIL_PRIVATE_KEY:-}" ]; then
        echo "   • ANVIL_PRIVATE_KEY missing; cannot enroll canonical wallet."
        return 1
    fi

    local identity_line
    identity_line=$(resolve_supabase_demo_identity || true)
    if [ -z "${identity_line}" ]; then
        return 1
    fi

    local enroll_user_id enroll_wallet
    enroll_user_id=$(printf '%s' "${identity_line}" | awk '{print $1}')
    enroll_wallet=$(printf '%s' "${identity_line}" | awk '{print $2}')
    if [ -z "${enroll_user_id}" ] || [[ ! "${enroll_wallet}" =~ ^0x[0-9a-f]{40}$ ]]; then
        echo "   • Failed to parse enrollment identity: ${identity_line}"
        return 1
    fi

    echo "   • Enrolling canonical wallet ${enroll_wallet} as userId=${enroll_user_id} on vault ${VAULT_ADDRESS}..."
    if ! cast send "${VAULT_ADDRESS}" \
        "syncUserAddress(uint256,address)" \
        "${enroll_user_id}" \
        "${enroll_wallet}" \
        --rpc-url "${DEMO_RPC_URL}" \
        --private-key "${ANVIL_PRIVATE_KEY}" \
        >/tmp/kyute_enroll_sync.log 2>&1; then
        echo "   • syncUserAddress enrollment failed."
        tail -n 20 /tmp/kyute_enroll_sync.log 2>/dev/null || true
        return 1
    fi

    local mapped_wallet
    mapped_wallet=$(cast call "${VAULT_ADDRESS}" "userIdToAddress(uint256)(address)" "${enroll_user_id}" --rpc-url "${DEMO_RPC_URL}" 2>/tmp/kyute_enroll_verify.err | tr '[:upper:]' '[:lower:]' || true)
    if [ "${mapped_wallet}" != "${enroll_wallet}" ]; then
        echo "   • Enrollment verification failed: expected ${enroll_wallet}, got ${mapped_wallet:-<empty>}."
        tail -n 10 /tmp/kyute_enroll_verify.err 2>/dev/null || true
        return 1
    fi

    echo "   ✓ Canonical wallet enrolled on new vault."
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

    local canonical_user
    canonical_user=$(resolve_canonical_demo_wallet || true)
    if [ -z "${canonical_user}" ]; then
        canonical_user="${demo_user}"
    fi

    echo "   • Seeding vault TVL to ${canonical_user} (canonical wallet); no demo userId mapping will be created..."
    cast send "${BOROS_COLLATERAL_ADDRESS}" "mint(address,uint256)" "${demo_user}" 1000000000000000000000 --private-key "${ANVIL_PRIVATE_KEY}" --rpc-url "${DEMO_RPC_URL}" >/tmp/kyute_seed_mint.log 2>&1 || true
    cast send "${BOROS_COLLATERAL_ADDRESS}" "approve(address,uint256)" "${VAULT_ADDRESS}" 1000000000000000000000 --private-key "${ANVIL_PRIVATE_KEY}" --rpc-url "${DEMO_RPC_URL}" >/tmp/kyute_seed_approve.log 2>&1 || true
    cast send "${VAULT_ADDRESS}" "deposit(uint256,address)" 100000000000000000000 "${canonical_user}" --private-key "${ANVIL_PRIVATE_KEY}" --rpc-url "${DEMO_RPC_URL}" >/tmp/kyute_seed_deposit.log 2>&1 || true
    echo "   ✓ Seed deposit attempted (logs: /tmp/kyute_seed_*.log)"
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
sync_direct_hl_env

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
upsert_env_var "${FRONTEND_ENV_LOCAL}" "NEXT_PUBLIC_KYUTE_VAULT_ADDRESS" "${VAULT_ADDRESS}"
if [ -n "${DEMO_SHOULD_HEDGE:-}" ]; then
    export DEMO_SHOULD_HEDGE
fi
if [ -n "${DEMO_FORCE_HEDGE:-}" ]; then
    export DEMO_FORCE_HEDGE
fi

if [ -f "${KYUTE_STAGING_CONFIG}" ]; then
    if command -v node >/dev/null 2>&1; then
        node -e '
            const fs = require("fs");
            const path = process.argv[1];
            const vaultAddress = process.argv[2];
            const sidecarUrl = process.argv[3];
            const json = JSON.parse(fs.readFileSync(path, "utf8"));
            json.vaultAddress = vaultAddress;
            json.agentSidecarUrl = sidecarUrl;
            fs.writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
        ' "${KYUTE_STAGING_CONFIG}" "${VAULT_ADDRESS}" "${KYUTE_AGENT_SIDECAR_URL}"
        echo "   ✓ Updated ${KYUTE_STAGING_CONFIG} with deployed vaultAddress and agentSidecarUrl"
    else
        echo "   • node not found; skipping automatic staging config update."
    fi
fi
echo "   ✓ Contracts deployed."
seed_demo_state
if ! enroll_canonical_wallet; then
    if [ "${DEMO_EXEC_MODE}" = "cre" ]; then
        echo "   ✗ Vault enrollment failed. CRE mode requires syncUserAddress during startup."
        exit 1
    fi
    echo "   • Continuing without automatic enrollment because mode=${DEMO_EXEC_MODE}."
fi
echo ""

# ── 4. Boot Sidecars ──────────────────────────────
echo "[3/4] Booting telemetry and agent sidecars..."
cd "${CRE_DIR}"
bun run boros-fetcher.ts > /dev/null 2>&1 &
FETCHER_PID=$!
echo "   ✓ Telemetry sidecar running in background (PID: ${FETCHER_PID})"
stop_existing_sidecar_on_port "${KYUTE_AGENT_SIDECAR_PORT}"
bun run kyute-agent-sidecar.ts > /tmp/kyute_agent_sidecar.log 2>&1 &
AGENT_SIDECAR_PID=$!
sleep 1
if ! kill -0 "${AGENT_SIDECAR_PID}" 2>/dev/null; then
    echo "   ✗ Agent sidecar failed to start. Last lines from /tmp/kyute_agent_sidecar.log:"
    tail -n 40 /tmp/kyute_agent_sidecar.log || true
    exit 1
fi
echo "   ✓ Agent sidecar running at ${KYUTE_AGENT_SIDECAR_URL} (PID: ${AGENT_SIDECAR_PID})"
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
