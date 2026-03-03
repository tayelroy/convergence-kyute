# kYUte Project Specification (v1.0)

**Goal:** One-click, AI-gated funding-rate hedge for Hyperliquid traders using Pendle Boros + Chainlink CRE.

## 1. Product Overview
**Name:** kYUte  
**Tagline:** Deposit once. Trade on Hyperliquid like normal. Let AI + Boros + CRE silently hedge your funding pain.  

Users deposit collateral into the kYUte Vault. They open/close Hyperliquid perpetual positions exactly as they would on the real app. Behind the scenes, CRE runs an hourly AI prediction and automatically opens the opposite Boros YU position **only** when the predicted floating funding is more expensive than the Boros implied yield. When the user closes on Hyperliquid, everything unwinds atomically.

## 2. Core Components

### 1) Smart Contracts (`contracts/src/kYUteVault.sol`)
ERC-4626 Vault deployed on Arbitrum.
- Handles user deposits
- Enforces max 10% TVL cap per hedge
- `executeHedge` callback restricted to `onlyCRE`
- Integrates `borosRouter` for Pendle YU positions

### 2) Chainlink CRE Workflow (`cre-workflow/kyute-funding-hedge`)
Verifiable execution logic using `@chainlink/cre-sdk`.
- `fetchData`: Gathers past 72h funding from Hyperliquid API + Boros implied APR
- `predictAndDecide`: Evaluates AI model for spread divergence 
- `callback`: Yields a signed mock zkp payload containing hedge execution commands to the Vault

### 3) Frontend Dashboard (`frontend/src/app`)
Next.js UI to track hedge positions, live APR differences, and proof hashes.
- To run: `cd frontend && npm install && npm run dev`
- To run hedge locally: Click "Run Hedge Now" simulated webhook

## Judge Quick Start (Simulation)
1. **Run CRE Node**:
```bash
cd cre-workflow/kyute-funding-hedge
bun install
cre run --mode=node
```

2. **Run Frontend**:
```bash
cd frontend
npm install
npm run dev
```

## Environment Variables
See `.env.example`. Make sure you configure the target Vault Addresses and RPC endpoints.