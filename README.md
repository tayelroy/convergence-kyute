# kYUte 🛡️

AI-Driven Yield Guardian for Personal Crypto Savings

> Convergence Hackathon 2025 Submission  
> Tracks: CRE & AI • Risk & Compliance • DeFi & Tokenization

kYUte transforms passive crypto savings into intelligent, self-protecting assets. By combining Chainlink CRE automation with Google Gemini AI, kYUte monitors your yield-bearing positions (e.g., USDe, ATOM) and automatically hedges against funding rate volatility using Pendle Boros.

---

## 🚀 Features

- Yield Risk Pulse: Real-time Gemini 3.0 Flash analysis of market volatility (0–100 Risk Score).
- Cross-Chain Oracle Intelligence: Compares Hyperliquid funding rates with Boros APRs to detect arbitrage-driven crash risks.
- Auto-Guard Agent: An autonomous Chainlink CRE workflow that monitors your portfolio on a 30s heartbeat.
- Smart Hedging: Automatically opens short Yield Unit (YU) positions on Boros when risk is critical.
- Threshold-Gated AI Calls: The agent only invokes Gemini when the spread exceeds a configurable threshold (default 8% = 800 bps), passing historical spreads to the model for trend-aware decisions.
- Consumer Dashboard: Simple, visually rich interface to track savings and toggle protection.

## 🛠️ Tech Stack

- Orchestration: Chainlink Runtime Environment (CRE)
- AI: Google Gemini 3.0 Flash
- DeFi: Pendle Boros (Arbitrum Sepolia)
- Contract: Solidity (`StabilityVault.sol`)
- Backend: TypeScript + Bun
- Frontend: Next.js, Tailwind, Recharts

## 📦 Installation

1) Clone the repo:
```bash
git clone https://github.com/tayelroy/convergence-kyute
cd convergence-kyute
```

2) Install dependencies:
```bash
# Backend / CRE workflow
cd cre-workflow
bun install

# Frontend (if applicable)
# cd frontend && npm install
```

3) Configure environment (root `.env`):
```env
# EVM
RPC_URL=http://127.0.0.1:8545               # Anvil (or your target RPC)
PRIVATE_KEY=0x...                           # Agent key (Anvil acct #1 in demo)
STABILITY_VAULT_ADDRESS=0x...               # Deployed StabilityVault address

# AI
GEMINI_API_KEY=your_gemini_key_here
AI_TRIGGER_SPREAD_BPS=800                   # 8% trigger (set to 500 for 5%)

# Optional cooldown (if you enable it)
# AI_MIN_INTERVAL_MS=60000
```

> Tip: In local demo, use `scripts/start_demo.sh` to fork Arbitrum with Anvil and deploy the `StabilityVault`. It prints the vault address and the agent account.

## 🏃‍♂️ Usage

### 1) Run the kYUte Agent (Backend)
The CRE workflow monitors yields, optionally calls Gemini AI (gated by spread threshold), and can execute hedges via the Vault.
```bash
cd cre-workflow
bun run dev
```

Agent behavior:
1. Monitor: Fetch Boros APR (Arbitrum) & Hyperliquid funding (annualized).
2. Gate AI: If spread ≥ `AI_TRIGGER_SPREAD_BPS`, call Gemini 3.0 Flash with recent spread history.
3. Decide: Compute a composite score using AI risk, confidence, and volatility factor from historical spreads.
4. Execute: If score > 100, call `openShortYU` on `StabilityVault`.

### 2) Deposit into the Vault (Anvil demo)
Use the payable `deposit()` so the per-user mapping and contract balance both reflect funds:
```bash
cast send <VAULT_ADDRESS> "deposit()" \
  --value 0.5ether \
  --rpc-url http://127.0.0.1:8545 \
  --private-key <ANVIL_AGENT_PRIVATE_KEY>
```

Verify:
```bash
cast balance <VAULT_ADDRESS> --rpc-url http://127.0.0.1:8545
cast call <VAULT_ADDRESS> "balances(address)" <AGENT_ADDRESS> --rpc-url http://127.0.0.1:8545
```

## 🧠 Threshold-Gated AI (What’s New)

- The agent runs every 30s, but Gemini is only called when the spread exceeds a configurable threshold (`AI_TRIGGER_SPREAD_BPS`, default 800 bps = 8%).
- The prompt includes a rolling window of historical spreads so Gemini evaluates both level and trend.
- If the spread remains above the threshold for multiple cycles, you can optionally enable a cooldown (`AI_MIN_INTERVAL_MS`) to avoid repeated calls.

### Sample Output

The following is a real agent log with a 5% (500 bps) demo threshold. Your default can be 8% (800 bps) by setting `AI_TRIGGER_SPREAD_BPS=800` in `.env`.

```
--- kyute Workflow [9:45:05 PM] ---
Yield Comparison:
Boros APR: 4.95%
Hyperliquid Funding (Annualized): 10.70%
Spread Annualized (Arb Opportunity): 5.75%
Spread (bps): 575 bps
Monitored Vault ETH: 1.0000 ETH
[AI] spreadBps=575 threshold=500
[AI] Triggered on threshold cross. spread=575 bps
AI Volatility Forecast: 22/100 (LOW)
   AI Reason: The current spread of 5.75% is at the bottom of the historical 5-11% range and well below the 8% threshold that triggers aggressive arbitrage pressure on Boros yields.
   Volatility Factor: 1.00x
   Confidence Boost: +0
   Composite Score: 27.75
Yield Stable. No hedge needed.
```

## 🧪 Testing & Verification

- Mock Mode: The agent falls back to mock logic if AI keys are missing or unreachable.
- Real AI: Provide a valid `GEMINI_API_KEY` to see actual generative risk assessments from Gemini 3.0 Flash.
- EVM Integration: Verified on Arbitrum Sepolia and local Anvil fork.

---

License: MIT