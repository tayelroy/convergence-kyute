#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# kYUte Demo — Anvil Mainnet Fork + Deploy
# ──────────────────────────────────────────────

ARBITRUM_RPC="https://arb1.arbitrum.io/rpc"
ANVIL_PORT=8545
ANVIL_URL="http://127.0.0.1:${ANVIL_PORT}"

# Anvil default account #0 (deterministic)
DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
# Use Anvil account #1 as the agent
AGENT_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

echo "=== kYUte Mainnet Fork Demo ==="
echo ""

# 1. Kill any existing anvil on this port
lsof -ti:${ANVIL_PORT} | xargs kill -9 2>/dev/null || true

# 2. Start anvil fork in background
echo "[1/3] Starting Anvil fork of Arbitrum One..."
anvil --fork-url "${ARBITRUM_RPC}" --port ${ANVIL_PORT} --block-time 2 &
ANVIL_PID=$!
sleep 3

# Verify anvil is running
if ! kill -0 ${ANVIL_PID} 2>/dev/null; then
    echo "ERROR: Anvil failed to start"
    exit 1
fi
echo "   Anvil PID: ${ANVIL_PID}"
echo "   RPC: ${ANVIL_URL}"

# 3. Install forge dependencies (if needed)
echo ""
echo "[2/3] Installing forge dependencies..."
cd "$(dirname "$0")/../contracts"
forge install OpenZeppelin/openzeppelin-contracts --no-git 2>/dev/null || true
forge install foundry-rs/forge-std --no-git 2>/dev/null || true

# 4. Deploy StabilityVault
echo ""
echo "[3/3] Deploying StabilityVault..."
DEPLOY_OUTPUT=$(AGENT_ADDRESS=${AGENT_ADDRESS} forge script \
    script/DeployStabilityVault.s.sol:DeployStabilityVault \
    --rpc-url "${ANVIL_URL}" \
    --private-key "${DEPLOYER_PRIVATE_KEY}" \
    --broadcast 2>&1)

echo "${DEPLOY_OUTPUT}"

# Extract deployed address from output
VAULT_ADDRESS=$(echo "${DEPLOY_OUTPUT}" | grep -oE "0x[a-fA-F0-9]{40}" | tail -1)

echo ""
echo "=========================================="
echo "  Demo Ready!"
echo "=========================================="
echo "  Anvil RPC:              ${ANVIL_URL}"
echo "  StabilityVault:         ${VAULT_ADDRESS}"
echo "  Agent (Anvil acct #1):  ${AGENT_ADDRESS}"
echo ""
echo "  Set in your .env:"
echo "    RPC_URL=${ANVIL_URL}"
echo "    STABILITY_VAULT_ADDRESS=${VAULT_ADDRESS}"
echo "    PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
echo ""
echo "  Then run: cd cre-workflow && bun run dev"
echo "=========================================="
echo ""
echo "Press Ctrl+C to stop Anvil (PID ${ANVIL_PID})"
wait ${ANVIL_PID}
