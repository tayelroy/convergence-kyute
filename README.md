# kYUte | Autonomous Yield Guardian

Convergence Hackathon submission for DeFi + AI Agent automation.

kYUte monitors funding-rate dislocations and executes hedge deposits on Pendle Boros from a TypeScript agent, while the Solidity vault remains intentionally minimal (custody + hedge audit events only).

## Core Architecture

- **Execution Layer:** `cre-workflow/agent.ts` uses `@pendle/sdk-boros` `Exchange.deposit(...)`.
- **On-chain Vault:** `contracts/src/StabilityVault.sol` holds ETH, accepts deposits, and emits `HedgeRecorded` via `recordHedge`.
- **Environment:** Arbitrum One **mainnet fork** via Anvil.
- **Telemetry:** Live events in Supabase (`kyute_events`, `funding_rates`) rendered by Next.js dashboard.

## Judge Quick Start (One Command)

```bash
bash scripts/start_demo.sh
```

This script:
1. forks Arbitrum One locally,
2. deploys `StabilityVault`,
3. updates root `.env`,
4. funds the vault,
5. prepares WETH collateral,
6. starts the agent heartbeat.

In another terminal, run the frontend:

```bash
cd frontend && npm run dev
```

Open `http://localhost:3000/dashboard`.

## Judge Verification Checklist (3 Proofs)

1. **Agent execution proof (terminal logs):**
   - `[BOROS] Market resolved`
   - `[BOROS] Deposit submitted successfully`
   - `[BOROS] recordHedge confirmed`

2. **On-chain proof (vault event):**

```bash
cast logs --rpc-url http://127.0.0.1:8545 --address <STABILITY_VAULT_ADDRESS>
```

Look for `HedgeRecorded(agent, amount, timestamp)`.

3. **Dashboard proof (live telemetry):**
   - `Execution Console` shows live AI + hedge events
   - `Yield Risk Gauge` reflects latest AI risk event
   - `My Savings`/history/positions panels reflect real Supabase rows

## Environment Variables (Root `.env`)

```env
# AI
GEMINI_API_KEY=...
AI_TRIGGER_SPREAD_BPS=800
HEDGE_COMPOSITE_THRESHOLD=100

# Local fork runtime
ANVIL_RPC_URL=http://127.0.0.1:8545
RPC_URL=http://127.0.0.1:8545
ANVIL_PRIVATE_KEY=0x...
PRIVATE_KEY=0x...

# Vault
STABILITY_VAULT_ADDRESS=0x...

# Boros
BOROS_MARKET_ADDRESS=0x8db1397beb16a368711743bc42b69904e4e82122
BOROS_COLLATERAL_ADDRESS=0x82af49447d8a07e3bd95bd0d56f35241523fbab1
BOROS_DEPOSIT_AMOUNT_ETH=0.05

# Supabase
SUPABASE_URL=...
SUPABASE_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Notes

- DeFi execution logic lives in TypeScript agent code, not in the vault.
- The vault intentionally does **not** call Pendle Router functions.
- If Boros/AI/Supabase upstreams fail, the system logs explicit failure states instead of fabricating data.