import type {
    SpreadData,
    VaultHealth,
    ProfitDataPoint,
    VenueVolume,
    BorosPosition,
} from "@/types/boros";

export const mockSpreads: SpreadData[] = [
    {
        asset: "BTC",
        longVenue: "Binance",
        longApr: 18.5,
        shortVenue: "Boros",
        shortApr: 12.0,
        netSpreadBps: 650,
    },
    {
        asset: "ETH",
        longVenue: "Bybit",
        longApr: 9.2,
        shortVenue: "Boros",
        shortApr: 7.8,
        netSpreadBps: 140,
    },
    {
        asset: "SOL",
        longVenue: "Hyperliquid",
        longApr: 22.4,
        shortVenue: "Boros",
        shortApr: 14.1,
        netSpreadBps: 830,
    },
    {
        asset: "ARB",
        longVenue: "Binance",
        longApr: 15.7,
        shortVenue: "Boros",
        shortApr: 11.3,
        netSpreadBps: 440,
    },
    {
        asset: "DOGE",
        longVenue: "Bybit",
        longApr: 31.2,
        shortVenue: "Boros",
        shortApr: 18.6,
        netSpreadBps: 1260,
    },
    {
        asset: "AVAX",
        longVenue: "Hyperliquid",
        longApr: 11.8,
        shortVenue: "Boros",
        shortApr: 10.5,
        netSpreadBps: 130,
    },
];

export const mockVault: VaultHealth = {
    totalNotional: 2_450_000,
    activeMargin: 24_500,
    currentLeverage: 100,
    estimatedHourlyYield: 18.42,
    activePairs: 4,
    uptime: 99.7,
};

export const mockProfitData: ProfitDataPoint[] = [
    { date: "Feb 10", profit: 124.5, cumulative: 124.5 },
    { date: "Feb 11", profit: 89.2, cumulative: 213.7 },
    { date: "Feb 12", profit: 156.8, cumulative: 370.5 },
    { date: "Feb 13", profit: 201.3, cumulative: 571.8 },
    { date: "Feb 14", profit: 178.6, cumulative: 750.4 },
    { date: "Feb 15", profit: 245.1, cumulative: 995.5 },
    { date: "Feb 16", profit: 312.4, cumulative: 1307.9 },
];

export const mockVenueVolumes: VenueVolume[] = [
    { venue: "Binance", volume: 1_240_000, color: "#F0B90B" },
    { venue: "Bybit", volume: 680_000, color: "#F7A600" },
    { venue: "Hyperliquid", volume: 530_000, color: "#00D1FF" },
];

export const mockPositions: BorosPosition[] = [
    {
        marketId: "btc-perp-2026q1",
        asset: "BTC",
        side: "long",
        notionalUsd: 1_000_000,
        entryImpliedApr: 12.0,
        currentImpliedApr: 11.2,
        leverage: 100,
        marginUsd: 10_000,
        unrealizedPnl: 342.5,
        openTimestamp: Date.now() - 3_600_000 * 4,
        txHash: "0xabc123...def456",
    },
    {
        marketId: "sol-perp-2026q1",
        asset: "SOL",
        side: "long",
        notionalUsd: 750_000,
        entryImpliedApr: 14.1,
        currentImpliedApr: 13.5,
        leverage: 100,
        marginUsd: 7_500,
        unrealizedPnl: 186.2,
        openTimestamp: Date.now() - 3_600_000 * 2,
        txHash: "0x789ghi...jkl012",
    },
    {
        marketId: "arb-perp-2026q1",
        asset: "ARB",
        side: "long",
        notionalUsd: 500_000,
        entryImpliedApr: 11.3,
        currentImpliedApr: 10.8,
        leverage: 50,
        marginUsd: 10_000,
        unrealizedPnl: 98.7,
        openTimestamp: Date.now() - 3_600_000 * 6,
        txHash: "0xmno345...pqr678",
    },
];
