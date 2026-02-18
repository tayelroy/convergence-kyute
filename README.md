# PROJECT NAME: kYUte

**AI-Driven Yield Guardian for Personal Crypto Savings**

> **Convergence Hackathon 2025 Submission**
> **Tracks:** DeFi & Capital Markets • Cross-Chain (CCIP) • AI Agents

kYUte transforms passive crypto savings into intelligent, self-protecting assets. By combining **Chainlink CRE** automation with **Google Gemini 3.0 Flash**, kYUte monitors your yield-bearing positions and automatically hedges against funding rate crashes using **Pendle Boros** (Yield Trading Protocol).

---

## Key Innovation: Mainnet-Forked Execution

Unlike typical hackathon projects that rely on mock contracts, **kYUte interacts with the real Boros Protocol on Arbitrum One.**

Because Boros (an institutional-grade Order Book for rates) is not deployed on Testnets, we utilize a **Mainnet Forking Architecture** (via Anvil) to demonstrate live, production-ready hedging without risking real capital.

## Features

- **Yield Risk Pulse:** Real-time Gemini 3.0 analysis of market volatility (0–100 Risk Score).
- **Boros Integration:** Direct interaction with the **Boros Router (Order Book)** to short Yield Units (YU) and lock in fixed rates.
- **Auto-Guard Agent:** An autonomous **Chainlink CRE** workflow that monitors your portfolio on a 30s heartbeat.
- **Mainnet Simulation:** A robust local environment that forks Arbitrum One state, allowing the agent to trade against real market liquidity and pricing.
- **Threshold-Gated AI:** The agent only invokes Gemini when the spread exceeds a configurable threshold (default 8% = 800 bps) to optimize costs.

---

## Tech Stack

- **Orchestration:** Chainlink Runtime Environment (CRE)
- **AI Model:** Google Gemini 3.0 Flash
- **DeFi Protocol:** Pendle Boros (Arbitrum One)
- **Smart Contract:** Solidity (`StabilityVault.sol` - Boros Compatible)
- **Simulation:** Foundry / Anvil (Mainnet Forking)
- **Backend:** TypeScript + Bun
- **Frontend:** Next.js, Tailwind, Recharts

---

## Installation & Setup

### 1. Clone the Repo
```bash
git clone [https://github.com/your-username/convergence-kyute.git](https://github.com/your-username/convergence-kyute.git)
cd convergence-kyute

```

### 2. Install Dependencies

```bash
# Install root dependencies
bun install

# Install workflow dependencies
cd cre-workflow && bun install

```

### 3. Configure Environment

Create a `.env` file in the root directory:

```env
# AI Configuration
GEMINI_API_KEY="your_google_api_key"
AI_TRIGGER_SPREAD_BPS=800

# Blockchain (Local Fork)
RPC_URL="[http://127.0.0.1:8545](http://127.0.0.1:8545)"
PRIVATE_KEY="your_anvil_private_key"

# Boros Configuration (Arbitrum One Mainnet Addresses)
BOROS_ROUTER_ADDRESS="0x8080808080daB95eFED788a9214e400ba552DEf6"
BOROS_COLLATERAL_ADDRESS="0x82af49447d8a07e3bd95bd0d56f35241523fbab1" # WETH (Must be lowercase)
BOROS_DEPOSIT_AMOUNT_ETH=0.5

```

---

## Running the Demo (Mainnet Fork)

Since Boros is Mainnet-only, we run the demo on a local fork of Arbitrum One.

### Step 1: Start the Mainnet Fork

Open a terminal and start Anvil. This downloads the real state of Arbitrum One to your machine.

```bash
# Requires Foundry (forge/cast/anvil)
anvil --fork-url [https://arb1.arbitrum.io/rpc](https://arb1.arbitrum.io/rpc) --port 8545

```

### Step 2: Deploy the Vault

In a new terminal, deploy the `StabilityVault` to your local fork.

```bash
cd contracts
forge create --rpc-url [http://127.0.0.1:8545](http://127.0.0.1:8545) \
  --private-key 0xac09... \
  src/StabilityVault.sol:StabilityVault \
  --constructor-args <YOUR_AGENT_ADDRESS>

```

*Copy the deployed contract address into your `.env` as `STABILITY_VAULT_ADDRESS`.*

### Step 3: Run the Agent

Start the Chainlink CRE Agent. It will monitor the (real) yields and execute hedges on the (forked) Boros protocol.

```bash
cd cre-workflow
npm run start

```

### Step 4: Verify Boros Deposit

To test the specific "Deposit into Boros" functionality manually:

```bash
npx ts-node cre-workflow/test-boros-deposit.ts

```

*Expected Output:*

```
[BOROS] Depositing via SDK...
[BOROS] Deposit receipt: { status: "success", transactionHash: "0x..." }

```

---

## Architecture: The "Hedge" Flow

1. **Monitor:** The Agent tracks the spread between **Hyperliquid Funding** (Floating) and **Boros Yield** (Fixed).
2. **Analyze:** If the spread > 8%, Gemini AI analyzes historical volatility to confirm a "Crash Risk."
3. **Action:**
* **Deposit:** The Vault deposits collateral (WETH) into the Boros Router.
* **Delegate:** The Vault authorizes the Agent to sign orders.
* **Short YU:** The Agent places a "Short Yield Unit" order on the Boros Order Book.


4. **Result:** The user locks in a fixed rate, protecting their savings from dropping funding rates.
