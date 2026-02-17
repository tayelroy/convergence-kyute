
# kYUte 🛡️

**AI-Driven Yield Guardian for Personal Crypto Savings**

> **Convergence Hackathon 2025 Submission**
> **Tracks:** CRE & AI • Risk & Compliance • DeFi & Tokenization

kYUte transforms passive crypto savings into intelligent, self-protecting assets. By combining **Chainlink CRE** automation with **Google Gemini AI**, kYUte monitors your yield-bearing positions (e.g., USDe, ATOM) and automatically hedges against funding rate volatility using **Pendle Boros**.

---

## 🚀 Features

- **Yield Risk Pulse**: Real-time **Gemini 2.0 Flash** (Exp) analysis of market volatility (0-100 Risk Score).
- **Auto-Guard Agent**: An autonomous Chainlink CRE workflow that monitors your portfolio 24/7.
- **Smart Hedging**: Automatically opens short Yield Unit (YU) positions on Boros when risk is critical.
- **Consumer Dashboard**: Simple, visually rich interface to track savings and toggle protection.

## 🛠️ Tech Stack

- **Orchestration**: Chainlink Runtime Environment (CRE)
- **AI**: Google Gemini Pro (via CRE HTTP Capability)
- **DeFi**: Pendle Boros (Arbitrum Sepolia)
- **Contract**: Solidity (`StabilityVault.sol`)
- **Frontend**: Next.js, Tailwind, Recharts

## 📦 Installation

1.  **Clone the repo:**
    ```bash
    git clone https://github.com/convergence-kyute
    cd convergence-kyute
    ```

2.  **Install dependencies:**
    ```bash
    # Root (Backend/CRE)
    npm install
    
    # Frontend
    cd frontend
    npm install
    ```

3.  **Configure Environment:**
    Create a `.env` file in the root:
    ```env
    RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
    PRIVATE_KEY=your_private_key_here
    GEMINI_API_KEY=your_gemini_key_here
    ```

## 🏃‍♂️ Usage

### 1. Run the kYUte Agent (Backend)
The CRE workflow monitors yields, calls Gemini AI, and executes hedges via the Vault.
```bash
# In project root
npx tsx cre-workflow/main.ts
```
*Output: You should see the agent connecting to Arbitrum, checking Boros rates, and logging real AI risk scores.*

### 2. Launch the Dashboard (Frontend)
Track your savings and agent activity.
```bash
# In frontend/
npm run dev
```
Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard).

### 3. Deploy Contracts (Optional)
To deploy your own Stability Vault on Arbitrum Sepolia:
```bash
forge script contracts/script/DeployStabilityVault.s.sol --rpc-url $RPC_URL --broadcast
```

> **Tip:** If you see `Gemini API 404` logs, ensure the **Google Generative Language API** is enabled in your Google Cloud Console project. The Agent will automatically fall back to mock data if the API is unavailable.

## 🧪 Testing & Verification

- **Mock Mode**: The agent gracefully falls back to mock logic if keys/contracts are missing, ensuring instant demo capability.
- **Real AI**: Provide a valid `GEMINI_API_KEY` to see actual generative risk assessments.
- **EVM Integration**: Verified on Arbitrum Sepolia testnet.

---

**License**: MIT