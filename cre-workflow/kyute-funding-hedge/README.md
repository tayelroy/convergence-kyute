# kYUte Funding Hedge CRE Workflow

This directory contains the Chainlink Runtime Environment (CRE) workflow that continuously monitors the Hyperliquid vs Boros yield spread and executes a hedge when conditions are met.

## Core Logic
1. **Fetch**: Retrieves the last 72h funding history from Hyperliquid and current Implied APR from Boros.
2. **Predict**: Feeds the data into an AI model (currently a deterministic mock for testing) to predict the closing funding rate and confidence score.
3. **Decide**: Combines the predictions with configured safety thresholds:
   - Predicted APR > Boros APR
   - Confidence ≥ 60%
   - Predicted Savings > 0.1% buffer
4. **Callback**: Emits an on-chain signed intent callback directed at the Arbitrum `kYUteVault.sol` contract to execute or close the position.

## Simulation / Local Node Mode

You can run this workflow locally in "Node Mode" using the Chainlink CRE SDK without deploying to a DON.

### Prerequisites
1. Ensure [Bun](https://bun.sh/) is installed.
2. Install the CRE CLI globally if not already installed: `npm i -g @chainlink/cre-cli`

### Setup
```bash
bun install
```

### Run Simulation
To execute the workflow exactly as it would run on a CRE DON node:
```bash
cre workflow simulate . --target=staging-settings
```
The CLI will read from `workflow.yaml` and `project.yaml`, utilize `config.staging.json`, and execute the pipeline defined in `workflow.ts`. You will see console logs outputting the HL APR, Boros APR, AI Decision, and the submitted mock EVM intent.
