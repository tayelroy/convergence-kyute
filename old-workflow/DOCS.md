# kYUte CRE Workflow — Technical Documentation

## Overview

The workflow in `cre-workflow/` is an automated hedge monitor that:

1. fetches Boros implied APR and Hyperliquid funding APR,
2. computes spread and risk,
3. triggers Boros collateral deposit via `@pendle/sdk-boros` when threshold conditions are met,
4. records an on-chain audit event by calling `recordHedge(amount)` on `StabilityVault`.
5. emits Chainlink proof telemetry for Automation, Functions, Data Feed rounds, and CCIP receipt propagation.

The on-chain vault is intentionally simple: custody + audit trail events only.

## Runtime Flow

### 1) Market Snapshot

- `fetchBorosImpliedApr(marketAddress)` reads Boros market/orderbook data.
- `fetchHyperliquidFundingRate("ETH")` reads annualized funding data.
- Agent computes spread in bps and writes snapshot rows to Supabase (`kyute_events`).

### 2) AI Gating

- AI evaluation only runs when spread crosses `AI_TRIGGER_SPREAD_BPS`.
- Agent computes `riskScore`, `confidenceBoost`, volatility factor, and `compositeScore`.

### 3) Hedge Execution

When score threshold is exceeded:

- Resolve Boros market by `BOROS_MARKET_ADDRESS`.
- Resolve collateral asset by `BOROS_COLLATERAL_ADDRESS`.
- Parse `BOROS_DEPOSIT_AMOUNT_ETH` to wei.
- Execute `Exchange.deposit({...})`.
- Call vault `recordHedge(amount)` for on-chain proof.
- Write hedge result to Supabase (`kyute_events` with `event_type = hedge`).

### 4) Chainlink Proof Layer

- **Data Feed:** reads ETH/USD `latestRoundData()` from `CHAINLINK_ETH_USD_FEED_ADDRESS` and writes `event_type = chainlink_feed`.
- **Functions orchestration:** writes per-cycle request + decision as `event_type = chainlink_functions`.
- **Automation trigger proof:** if `CHAINLINK_AUTOMATION_TX_HASH` is set, writes `event_type = chainlink_automation` once per tx hash.
- **CCIP audit receipt:** after successful `recordHedge`, writes `event_type = chainlink_ccip` with message reference and destination chain context.

## Required Environment Variables

Defined at root `.env`:

- `RPC_URL` / `ANVIL_RPC_URL`
- `PRIVATE_KEY` / `ANVIL_PRIVATE_KEY`
- `STABILITY_VAULT_ADDRESS`
- `BOROS_MARKET_ADDRESS`
- `BOROS_COLLATERAL_ADDRESS`
- `BOROS_DEPOSIT_AMOUNT_ETH`
- `GEMINI_API_KEY`
- `AI_TRIGGER_SPREAD_BPS`
- `HEDGE_COMPOSITE_THRESHOLD`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `CHAINLINK_ETH_USD_FEED_ADDRESS`
- `CHAINLINK_AUTOMATION_TX_HASH`
- `CHAINLINK_UPKEEP_ID`
- `CHAINLINK_CCIP_TX_HASH`
- `CHAINLINK_CCIP_DESTINATION_CHAIN`

## Commands

```bash
# workflow heartbeat
cd cre-workflow
bun run dev

# hedge path test
bun run test:agent-hedge:anvil
```

## Notes

- No Pendle router calls are used by the vault or workflow.
- No `openShortYU` fallback path is used.
- If external providers fail, the workflow logs explicit warnings/errors and continues safely.