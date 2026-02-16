# Kyute CRE Workflow — Technical Documentation

## Overview

The Kyute CRE Workflow is a **funding rate arbitrage scanner** built on the [Chainlink Runtime Environment (CRE)](https://chain.link). It pulls real-time funding rates from multiple exchanges, verifies them through decentralized consensus, and identifies profitable spreads between CEX floating rates and DeFi fixed rates on Pendle Boros.

---

## How It Works

### The Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  1. FETCH          2. NORMALIZE          3. CONSENSUS           │
│                                                                 │
│  Binance API ──►  Annualize to APR ──►  Median of all   ──►  R_cex
│  (8h rate)        (×3 ×365 ×100)        venues per asset       │
│                                                                 │
│  Hyperliquid ──►  Annualize to APR ──►  Outlier filter         │
│  (1h rate)        (×24 ×365 ×100)       (>5% from median)      │
└─────────────────────────────────────────────────────────────────┘
```

### Step 1: Fetch Raw Rates

Each exchange returns funding rates at different intervals and in different formats:

| Exchange | Endpoint | Method | Funding Period | Raw Example |
|---|---|---|---|---|
| **Binance** | `/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1` | GET | Every **8 hours** | `"fundingRate": "0.0001"` (= 0.01%) |
| **Hyperliquid** | `/info` with `{ type: "fundingHistory" }` | POST | Every **1 hour** | `"fundingRate": "0.00001024"` (= 0.001%) |

### Step 2: Annualize to APR (%)

Because each exchange settles funding at different intervals, we must normalize them to the same unit — **annualized APR (%)** — before comparing.

#### Binance (8-hour funding)

```
Funding is charged 3× per day (every 8 hours).

APR = rawRate × 3 × 365 × 100

Example:
  rawRate = 0.0001 (this means 0.01% per 8h)
  APR     = 0.0001 × 3 × 365 × 100 = 10.95%
```

#### Hyperliquid (1-hour funding)

The `metaAndAssetCtxs` API returns the **hourly** predicted funding rate.

```
Funding is charged 24× per day (every 1 hour).

APR = rawHourlyRate × 24 × 365 × 100

Example:
  rawHourlyRate = 0.00000075 (0.000075% per hour)
  8h Rate       = 0.00000075 × 8 = 0.0006% (Matches UI 8h view)
  APR           = 0.00000075 × 24 × 365 × 100 = 0.657%
```

> [!IMPORTANT]
> **API vs UI Discrepancy**: The Hyperliquid UI typically shows the **8h equivalent** rate (e.g. 0.0040%), but the API returns the **1h raw** rate. You must multiply the API value by 8 to compare with the UI, or by 24×365 to get the APR.
>
> We use `metaAndAssetCtxs` (not `fundingHistory`) to get the live predicted rate.

### Step 3: Consensus Aggregation

Once all rates are normalized to APR, we group them by asset (BTC, ETH) and compute the **median**:

```
Given:  Binance BTC = -3.59%,  Hyperliquid BTC = 8.88%
Median: (-3.59 + 8.88) / 2 = 2.65%
```

#### Outlier Filtering

When 3+ data sources exist, any rate deviating >5% from the median is discarded. This prevents a single manipulated oracle from corrupting the consensus. With only 2 sources (as currently), all data is trusted.

#### CRE DON Consensus

In production, this runs across a **Decentralized Oracle Network (DON)**:

```
DON Node A ──► fetchGlobalRates() ──► {btc: 2.65%, eth: 0.31%}
DON Node B ──► fetchGlobalRates() ──► {btc: 2.64%, eth: 0.31%}
DON Node C ──► fetchGlobalRates() ──► {btc: 2.65%, eth: 0.32%}
                                          │
                          consensusMedianAggregation
                                          │
                              Final R_cex: {btc: 2.65%, eth: 0.31%}
```

Each node fetches independently via `runInNodeMode`, then results are aggregated using `consensusMedianAggregation` — ensuring no single node can fake the data.

---

## Configuration

All parameters are validated at startup. You can configure them via environment variables in a `.env` file at the **project root**.

Example `.env`:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJh...
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `binanceApiUrl` | URL | `https://fapi.binance.com/fapi/v1/fundingRate` | Binance Futures funding rate endpoint |
| `hyperliquidApiUrl` | URL | `https://api.hyperliquid.xyz/info` | Hyperliquid info endpoint |
| `borosMarketAddress` | `0x...` (40 hex) | `0x0000...0000` | Pendle Boros market contract on Arbitrum |
| `minSpreadThresholdBps` | integer ≥ 1 | `20` | Minimum spread (bps) to trigger execution |

---

## Output Example

```
━━━ Consensus Results (R_cex) ━━━
  BTC median rate:  2.6479% APR
    Sources: binance(-3.5883%), hyperliquid(8.8840%)
  ETH median rate:  0.3110% APR
    Sources: binance(-6.4879%), hyperliquid(7.1100%)
```

---

## File Structure

```
cre-workflow/
├── main.ts          # Entry point — config, fetching, consensus
├── project.yaml     # CRE deployment config (Arbitrum Sepolia)
├── package.json     # Dependencies (@chainlink/cre-sdk, zod)
└── tsconfig.json    # TypeScript config (ES2022, strict)
```
