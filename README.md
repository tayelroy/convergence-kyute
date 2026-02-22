# kYUte | Autonomous Yield Guardian

Convergence Hackathon submission for DeFi + AI Agent automation.

kYUte monitors funding-rate dislocations and executes hedge deposits on Pendle Boros from a TypeScript agent, while the Solidity vault remains intentionally minimal (custody + hedge audit events only).

## Chainlink Integrations (Explicit)

- **Automation proof:** The agent records `chainlink_automation` events (upkeep tx hash + upkeep id) from `CHAINLINK_AUTOMATION_TX_HASH` and `CHAINLINK_UPKEEP_ID`.
- **Functions orchestration:** Each cycle emits a `chainlink_functions` decision event with request id, action (`HEDGE`/`HOLD`), and confidence.
- **Data Feeds:** Agent reads Chainlink ETH/USD `latestRoundData()` from `CHAINLINK_ETH_USD_FEED_ADDRESS` (default Arbitrum feed) and logs feed round + price in `chainlink_feed` events.
- **CCIP audit story:** After each successful hedge record tx, agent emits a `chainlink_ccip` receipt event (message id + destination chain + tx hash if provided).

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

The dashboard now surfaces Chainlink proofs in three places:
- ticker (`LINK Feed` price + round),
- Auto-Guard panel (Automation tx, Functions request id, Feed round, CCIP tx),
- Execution Console (`[CHAINLINK][AUTOMATION|FUNCTIONS|FEED|CCIP]` logs).

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

4. **Chainlink proof (dashboard + Supabase):**
   - `chainlink_automation`: upkeep transaction hash
   - `chainlink_functions`: request id + decision
   - `chainlink_feed`: ETH/USD feed round + price
   - `chainlink_ccip`: cross-domain audit receipt reference

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

# Chainlink Integrations
CHAINLINK_ETH_USD_FEED_ADDRESS=0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612
CHAINLINK_AUTOMATION_TX_HASH=0x...
CHAINLINK_UPKEEP_ID=...
CHAINLINK_CCIP_TX_HASH=0x...
CHAINLINK_CCIP_DESTINATION_CHAIN=ethereum-mainnet
```

## Notes

- DeFi execution logic lives in TypeScript agent code, not in the vault.
- The vault intentionally does **not** call Pendle Router functions.
- If Boros/AI/Supabase upstreams fail, the system logs explicit failure states instead of fabricating data.