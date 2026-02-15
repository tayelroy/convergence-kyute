# Kyute: Decentralized Funding Rate Arbitrage Vault

Kyute is an institutional-grade yield strategy platform designed to capture structural inefficiencies in global funding rate markets. By leveraging the Chainlink Runtime Environment (CRE) as a decentralized orchestration layer and Pendle Boros as the execution venue, Kyute automates high-leverage interest rate swaps between fragmented centralized and decentralized exchanges.

## 1. Project Vision

In the 2026 derivatives market, funding rates are highly volatile cash flows. While institutional arbitrage capital often enforces a "structural floor" near a baseline of 0.01% per 8-hour period, fragmented liquidity across venues like Binance, Bybit, and Hyperliquid creates persistent tactical gaps. Kyute democratizes access to these "Basis-Yield" opportunities by automating the identification, consensus-verification, and execution of these spreads with decentralized logic.

## 2. Technical Architecture & Directory Layout

Kyute is built as a multi-component system following the standard CRE project structure.

### Repository Structure

- **/cre-workflow**: A TypeScript project containing the strategy orchestration.
    - `project.yaml`: Global settings and RPC endpoint configurations.
    - `workflow.yaml`: Workflow-specific triggers and artifacts.
    - `main.ts`: The primary logic for scanning venues and calculating spreads.
- **/contracts**: A Foundry project containing the settlement logic.
    - `KyuteVault.sol`: Smart contract implementing the `IReceiver` interface to securely accept reports from the CRE Forwarder.
- **/frontend**: UI for monitoring active Boros positions and vault health.

## 3. Workflow Execution Lifecycle

Kyute fulfills the hackathon's "Orchestration" requirement by linking external exchange APIs with on-chain smart contracts via a verifiable workflow.

- **Trigger (The Scan)**: A Cron Trigger activates the workflow every 5 minutes to monitor global funding rates.
- **External Data (HTTP Capability)**: DON nodes independently fetch real-time funding data from Binance, Bybit, and Hyperliquid APIs.
- **Consensus (Off-chain Compute)**: Results are aggregated via a Byzantine Fault Tolerant (BFT) consensus protocol. Kyute utilizes `consensusMedianAggregation` to filter out outliers or malformed API responses.
- **Execution (EVM Write Capability)**: If the spread between the CEX rate ($R_{cex}$) and the Boros Implied APR ($R_{boros}$) exceeds 20 basis points, the CRE generates a signed report and calls the `placeOrder` function on the Boros Router.

## 4. Statistical Persistence & Edge

Kyute exploits the predictive window created by CEX-to-DEX causality, where information flow typically runs from Binance/Bybit to decentralized platforms like Hyperliquid.

- **Autocorrelation**: First-order autocorrelations for venue spreads range from $0.966$ to $0.998$, meaning a spread observed in the current period is a reliable predictor of the next.
- **Half-Life Realities**: While major assets like $ETH$ revert in ~20 minutes, smaller-cap assets exhibit spreads that persist for hours or days.
- **Frequency**: Economically significant spreads ($\ge 20$ bps) occur in approximately 17% of derivatives market observations.

## 5. Financial Mechanics

### Capital Efficiency & Leverage

Pendle Boros allows Kyute to express views on interest rates with up to 1000x capital efficiency. This enables a $1,000 vault deposit to control a $1,000,000 notional position.

### Profit Formula

Hourly realized yield is calculated as:

$$Profit = Notional \times \frac{(R_{actual} - R_{fixed})}{8760}$$

Where $R_{actual}$ is the underlying floating rate and $R_{fixed}$ is the entry implied APR.

## 6. Implementation Snippet

The workflow uses `MarketAccLib` to pack hexadecimal account identifiers, ensuring strategy isolation within the vault contract.

```typescript
// Core implementation for Kyute strategy execution
const marketAcc = MarketAccLib.pack(vaultAddress, subaccountId, tokenId, marketId);

if (consensusSpread > threshold) {
    const reportPromise = runtime.report(prepareReportRequest(
        encodeFunctionData({
            abi: BOROS_ROUTER_ABI,
            functionName: "placeOrder",
            args: []
        })
    ));
    
    const report = reportPromise.result();
    await evmClient.writeReport(runtime, { receiver: vaultAddress, report });
}
```

## 7. Submission Mock Scenario

The following scenario is demonstrated in the Kyute demo video and CRE CLI simulation:

| Parameter | Mock Data Value | Real-World Context |
| :--- | :--- | :--- |
| Hyperliquid Actual Rate | 18.50% APR | Hyperliquid spikes during market volatility |
| Boros Implied APR | 12.00% APR | On-chain liquidity often lags CEX moves |
| Net Arbitrage Spread | 6.50% APR | WLFI once exhibited a 9.08% net spread |
| Leverage Ratio | 100x | High-efficiency institutional setup |

On a 100 $BTC$ notional position, Kyute captures ~$0.00074$ $BTC$ per hour while remaining delta-neutral.

---

**Disclaimer: Kyute is for hackathon demonstration purposes. Derivatives trading involves significant risk of liquidation.**