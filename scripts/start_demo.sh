#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# kYUte — One-line Demo
# Forks Arbitrum One, deploys vault, funds it,
# writes .env, then starts the agent.
# Usage: bash scripts/start_demo.sh
# ──────────────────────────────────────────────

ARBITRUM_RPC="https://arb1.arbitrum.io/rpc"
ANVIL_PORT=8545
ANVIL_URL="http://127.0.0.1:${ANVIL_PORT}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
WETH_ADDRESS="0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
BOROS_MARKET_DEFAULT="0x8db1397beb16a368711743bc42b69904e4e82122"
BOROS_COLLATERAL_DEFAULT="${WETH_ADDRESS}"
BOROS_DEPOSIT_DEFAULT="0.05"
BOROS_WRAP_BUFFER_ETH="1.0"

# Anvil account #0 — deployer & depositor
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Anvil account #1 — agent (signs hedge txs)
AGENT_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
AGENT_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

echo "╔══════════════════════════════════════════╗"
echo "║               kYUte Demo                 ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Kill any existing Anvil ─────────────────
lsof -ti:${ANVIL_PORT} | xargs kill -9 2>/dev/null || true

# ── 2. Start Anvil fork ────────────────────────
echo "[1/6] Starting Anvil fork of Arbitrum One..."
anvil \
  --fork-url "${ARBITRUM_RPC}" \
  --port ${ANVIL_PORT} \
  --chain-id 42161 \
  --block-time 2 \
  --state "${ROOT_DIR}/.anvil-state.json" \
  --silent &
ANVIL_PID=$!

if ! kill -0 ${ANVIL_PID} 2>/dev/null; then
    echo "ERROR: Anvil failed to start"
    exit 1
fi

echo "   Waiting for RPC readiness..."
for i in {1..30}; do
    if cast block-number --rpc-url "${ANVIL_URL}" >/dev/null 2>&1; then
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "ERROR: Anvil RPC did not become ready at ${ANVIL_URL}"
        kill ${ANVIL_PID} 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

echo "   ✓ Anvil running (PID ${ANVIL_PID}) at ${ANVIL_URL}"

# ── 3. Deploy StabilityVault ───────────────────
echo ""
echo "[2/6] Deploying StabilityVault..."
cd "${ROOT_DIR}/contracts"
set +e
DEPLOY_OUTPUT=$(AGENT_ADDRESS=${AGENT_ADDR} forge script \
    script/DeployStabilityVault.s.sol:DeployStabilityVault \
    --rpc-url "${ANVIL_URL}" \
    --private-key "${DEPLOYER_KEY}" \
    --broadcast 2>&1)
DEPLOY_EXIT=$?
set -e

if [ ${DEPLOY_EXIT} -ne 0 ]; then
    echo "ERROR: DeployStabilityVault failed"
    echo "${DEPLOY_OUTPUT}"
    kill ${ANVIL_PID} 2>/dev/null || true
    exit 1
fi

VAULT_ADDRESS=$(echo "${DEPLOY_OUTPUT}" | grep -oE "0x[a-fA-F0-9]{40}" | tail -1)

if [ -z "${VAULT_ADDRESS}" ]; then
    echo "ERROR: Could not extract vault address from deploy output:"
    echo "${DEPLOY_OUTPUT}"
    kill ${ANVIL_PID}
    exit 1
fi
echo "   ✓ StabilityVault deployed at ${VAULT_ADDRESS}"

# ── 4. Write .env ──────────────────────────────
echo ""
echo "[3/6] Writing .env..."

# Preserve existing keys (GEMINI, SUPABASE, BOROS, etc.) and update/add infra keys
update_env() {
    local key=$1
    local value=$2
    if grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
        # Update existing line (macOS + Linux compatible)
        sed -i.bak "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
    else
        echo "${key}=${value}" >> "${ENV_FILE}"
    fi
}

touch "${ENV_FILE}"
update_env "ANVIL_RPC_URL"            "${ANVIL_URL}"
update_env "RPC_URL"                  "${ANVIL_URL}"
update_env "ANVIL_PRIVATE_KEY"        "${AGENT_KEY}"
update_env "PRIVATE_KEY"              "${AGENT_KEY}"
update_env "STABILITY_VAULT_ADDRESS"  "${VAULT_ADDRESS}"
update_env "BOROS_MARKET_ADDRESS"     "${BOROS_MARKET_DEFAULT}"
update_env "BOROS_COLLATERAL_ADDRESS" "${BOROS_COLLATERAL_DEFAULT}"
update_env "BOROS_DEPOSIT_AMOUNT_ETH" "${BOROS_DEPOSIT_DEFAULT}"

echo "   ✓ .env updated"

# ── 5. Fund the vault ──────────────────────────
echo ""
echo "[4/6] Funding vault with 0.5 ETH..."
cd "${ROOT_DIR}/cre-workflow"
bun run deposit.ts
echo "   ✓ Vault funded"

# ── 6. Ensure agent has WETH collateral ─────────
echo ""
echo "[5/6] Wrapping ${BOROS_WRAP_BUFFER_ETH} ETH to WETH for agent collateral..."
cast send "${WETH_ADDRESS}" \
    "deposit()" \
    --value "${BOROS_WRAP_BUFFER_ETH}ether" \
    --rpc-url "${ANVIL_URL}" \
    --private-key "${AGENT_KEY}" >/dev/null
echo "   ✓ Agent WETH prepared"

# ── 7. Start the agent ─────────────────────────
echo ""
echo "[6/6] Starting kYUte agent..."
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║              Demo Running!               ║"
echo "║                                          ║"
echo "║  Vault:  ${VAULT_ADDRESS:0:20}...         ║"
echo "║  Agent:  ${AGENT_ADDR:0:20}...         ║"
echo "║  RPC:    ${ANVIL_URL}           ║"
echo "║                                          ║"
echo "║  Press Ctrl+C to stop                    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Trap Ctrl+C to cleanly kill Anvil
trap "echo ''; echo 'Stopping...'; kill ${ANVIL_PID} 2>/dev/null; exit 0" INT TERM

bun run dev