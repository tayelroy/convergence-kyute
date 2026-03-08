# kYUte

kYUte is a local-first demo of an AI-guided funding hedge for Hyperliquid traders. The stack combines a vault-backed collateral flow, a Next.js dashboard, and a CRE-powered executor path that can be simulated locally.

## Repo Layout

- `frontend/`: Next.js dashboard, strategy lab, demo faucet, and vault deposit flow
- `contracts/`: vault contract and local/demo deployment scripts
- `cre-kyute/`: CRE workflow, sidecar, and direct execution helpers
- `scripts/start_demo.sh`: boots the local demo chain and syncs frontend env values

## Local Demo Quick Start

### Prerequisites

- Node.js and npm
- Bun
- Foundry (`anvil`, `forge`, `cast`)

### 1. Configure env files

The demo launcher reads `contracts/.env`, and the frontend reads `frontend/.env.local`.

- Start from `./.env.example` for contract-side values.
- Start from `./frontend/.env.local.example` for frontend local values.
- Add `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` if you want wallet connect and live approve/deposit from the UI.
- Add `OPENAI_API_KEY` if you want to use the strategy generation panel.

At minimum, the local demo expects `BOROS_ROUTER_ADDRESS` and `BOROS_COLLATERAL_ADDRESS` to be available in `contracts/.env`.

### 2. Start the local demo stack

```bash
./scripts/start_demo.sh
```

The script:

- starts Anvil on `http://127.0.0.1:8545`
- deploys or reuses the demo vault flow
- syncs `NEXT_PUBLIC_KYUTE_VAULT_ADDRESS` into `frontend/.env.local`
- syncs `NEXT_PUBLIC_BOROS_COLLATERAL_ADDRESS` into `frontend/.env.local` when demo collateral is available
- normalizes the frontend to use the local vault RPC and chain id

If CRE enrollment cannot reach Supabase because DNS or network is unavailable, rerun with:

```bash
DEMO_EXEC_MODE=direct ./scripts/start_demo.sh
```

### 3. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo Flow

1. Connect a wallet with `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` configured.
2. Open the Strategy page.
3. In demo mode, use the faucet to fund gas and mock collateral.
4. Switch the wallet to the local vault chain when prompted.
5. Approve collateral, then deposit into the vault.
6. Use the strategy lab to generate and apply an AI patch for the ETH and BTC market rows.

## Current Frontend Behavior

- The vault deposit rail resolves the vault asset on-chain and falls back to `NEXT_PUBLIC_BOROS_COLLATERAL_ADDRESS` for local demo setups.
- Approve and deposit actions fetch `/api/wallet-nonce` before sending transactions so the UI can pass the current nonce explicitly on local Anvil flows.
- Local RPC URLs are normalized to `127.0.0.1` instead of `localhost` to avoid wallet and RPC mismatches.
- The AI strategy generator returns market-scoped patches with explicit `null` values for unchanged fields.
- Applying an AI plan now shows transient confirmation in the strategy form so the operator can verify the updated ETH and BTC rows before saving or running again.

## Troubleshooting

- If the deposit buttons stay disabled, confirm the wallet is connected, funded by the demo faucet, and switched to the local vault chain.
- If the vault asset cannot be resolved, confirm `NEXT_PUBLIC_KYUTE_VAULT_ADDRESS`, `NEXT_PUBLIC_KYUTE_RPC_URL`, and `NEXT_PUBLIC_BOROS_COLLATERAL_ADDRESS` are present in `frontend/.env.local`.
- If wallet connect is unavailable, add `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` and restart the frontend dev server.
- If strategy generation fails, confirm `OPENAI_API_KEY` is available to the Next.js server.
