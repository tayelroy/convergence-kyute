/**
 * Pendle Boros position types.
 * These mirror the expected @pendle/sdk-boros interfaces.
 */

export interface BorosPosition {
    marketId: string;
    asset: string;
    side: "long" | "short";
    notionalUsd: number;
    entryImpliedApr: number;
    currentImpliedApr: number;
    leverage: number;
    marginUsd: number;
    unrealizedPnl: number;
    openTimestamp: number;
    txHash: string;
}

export interface TradeSignal {
    id: string;
    asset: string;
    cexRate: number;
    borosRate: number;
    spreadBps: number;
    timestamp: number;
    txHash: string | null;
    venue: string;
    status: "pending" | "executed" | "skipped";
}

export interface VaultHealth {
    totalNotional: number;
    activeMargin: number;
    currentLeverage: number;
    estimatedHourlyYield: number;
    activePairs: number;
    uptime: number;
}

export interface SpreadData {
    asset: string;
    longVenue: string;
    longApr: number;
    shortVenue: string;
    shortApr: number;
    netSpreadBps: number;
}

export interface ProfitDataPoint {
    date: string;
    profit: number;
    cumulative: number;
}

export interface VenueVolume {
    venue: string;
    volume: number;
    color: string;
}
