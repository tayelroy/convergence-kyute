

# kYUte | Autonomous Yield Guardian

**Convergence Hackathon 2025 Submission** **Tracks:** DeFi & Capital Markets • Cross-Chain (CCIP) • AI Agents

kYUte transforms passive crypto savings into intelligent, self-protecting assets. By combining **Chainlink CRE** automation with **Google Gemini 3.0 Flash**, kYUte monitors your yield-bearing positions and automatically hedges against funding rate crashes using the **Pendle Boros** Order Book.

---

## The Innovation: Live Execution via Mainnet Forking

Unlike typical hackathon projects that rely on mock contracts and simulated frontend timers, **kYUte interacts with the real Boros Protocol on Arbitrum One** and streams live execution data to our Next.js dashboard. 

Because Boros is an institutional-grade Order Book for rates without a Testnet deployment, we utilize a **Mainnet Forking Architecture** (via Anvil). This allows our Chainlink Agent to demonstrate production-ready hedging against real market liquidity without risking user capital.

## Key Features

- **Yield Risk Pulse:** Real-time Gemini 3.0 analysis of market volatility (0–100 Risk Score).
- **Boros Integration:** Direct interaction with the **Boros Router** to short Yield Units (YU) and lock in fixed rates.
- **Auto-Guard Agent:** An autonomous **Chainlink CRE** workflow that monitors your portfolio on a 30s heartbeat.
- **Live Supabase Telemetry:** The Next.js dashboard is powered entirely by live Supabase queries (`kyute_events` and `funding_rates`). *Zero mock data. Zero simulated timers.*
- **Threshold-Gated AI:** The agent only invokes Gemini when the spread exceeds a configurable threshold (default 8% = 800 bps), optimizing API costs and ensuring mathematical accuracy.

---

## Judge's 3-Minute Quick Start ("Happy Path")

To verify kYUte's live execution architecture, follow these 4 steps to run a complete end-to-end hedge.

### Step 1: Start the Mainnet Fork
Open a terminal and start Anvil. This downloads the live state of Arbitrum One to your machine.
```bash
# Requires Foundry installed
anvil --fork-url [https://arb1.arbitrum.io/rpc](https://arb1.arbitrum.io/rpc) --port 8545

```

### Step 2: Deploy the Vault & Start the Agent

In a new terminal, deploy the `StabilityVault` to your local fork and start the Chainlink CRE Agent.

```bash
# 1. Install dependencies
bun install
cd cre-workflow && bun install

# 2. Deploy Vault (ensure your .env is configured with ANVIL_PRIVATE_KEY)
cd ../contracts
forge create --rpc-url [http://127.0.0.1:8545](http://127.0.0.1:8545) --private-key <YOUR_PRIVATE_KEY> src/StabilityVault.sol:StabilityVault --constructor-args <AGENT_ADDRESS>

# 3. Start the Agent Workflow
cd ../cre-workflow
npm run start

```

### Step 3: Trigger the Hedge (Terminal Verification)

Watch the `cre-workflow` terminal. You will see:

1. The Agent detecting the Spread (e.g., `Spread (bps): 850 bps`).
2. Gemini 3.0 analyzing the crash risk.
3. The successful **Boros Margin Deposit** executing on the local Arbitrum fork.

### Step 4: Verify the Dashboard

Open the Next.js frontend:

```bash
cd frontend
npm run dev

```

Navigate to `http://localhost:3000`. You will see the **Execution Console** and **Yield Risk Gauge** update in real-time, fetching the exact transaction hashes directly from Supabase.

---

## Architecture & Tech Stack

* **Orchestration:** Chainlink Runtime Environment (CRE)
* **AI Model:** Google Gemini 3.0 Flash
* **DeFi Protocol:** Pendle Boros (Arbitrum One)
* **Smart Contract:** Solidity (`StabilityVault.sol`)
* **Simulation:** Foundry / Anvil (Mainnet Forking)
* **Backend:** TypeScript + Bun + Boros SDK
* **Frontend / DB:** Next.js, Tailwind, Recharts, Supabase

### Strict Metric Standardization

To prevent display errors and mathematically impossible yields, all system metrics are standardized across the stack:

* **Backend:** Evaluates raw values and base points (bps).
* **Database (Supabase):** Stores historical rates as raw percentages.
* **Frontend:** Displays `median_apr` without re-annualizing, ensuring complete transparency and accuracy.
* **API Resiliency:** Frontend routes include explicit error handling and "Awaiting Data" fallback states if the Chainlink Agent is paused.

---

## Environment Setup

To run kYUte yourself, create a `.env` file in the root directory:

```env
# AI Configuration
GEMINI_API_KEY="your_google_api_key"
AI_TRIGGER_SPREAD_BPS=800

# Blockchain (Local Fork - Arbitrum One)
RPC_URL="[http://127.0.0.1:8545](http://127.0.0.1:8545)"
PRIVATE_KEY="your_anvil_private_key"

# Boros Configuration (Mainnet Addresses)
BOROS_ROUTER_ADDRESS="0x8080808080daB95eFED788a9214e400ba552DEf6"
BOROS_COLLATERAL_ADDRESS="0x82af49447d8a07e3bd95bd0d56f35241523fbab1" # WETH (Must be lowercase)
BOROS_DEPOSIT_AMOUNT_ETH=0.5

# Database
NEXT_PUBLIC_SUPABASE_URL="your_supabase_url"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your_supabase_anon_key"