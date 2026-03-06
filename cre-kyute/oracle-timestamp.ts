const DEFAULT_MAX_ORACLE_DELAY_SEC = 300;

export type OracleTimestampResolutionSource =
  | "latest_point"
  | "current_time_no_point"
  | "current_time_stale_point"
  | "current_time_future_point";

export type OracleTimestampResolution = {
  oracleTimestampSec: bigint;
  source: OracleTimestampResolutionSource;
  latestPointSec: bigint | null;
};

export const resolveFreshOracleTimestamp = (
  latestTimestampMs: number | null | undefined,
  options?: {
    nowMs?: number;
    maxDelaySec?: number;
  },
): OracleTimestampResolution => {
  const nowMs = options?.nowMs ?? Date.now();
  const maxDelaySec = options?.maxDelaySec ?? DEFAULT_MAX_ORACLE_DELAY_SEC;
  const nowSec = Math.floor(nowMs / 1000);

  if (!Number.isFinite(latestTimestampMs ?? NaN) || latestTimestampMs == null || latestTimestampMs <= 0) {
    return {
      oracleTimestampSec: BigInt(nowSec),
      source: "current_time_no_point",
      latestPointSec: null,
    };
  }

  const latestSec = Math.floor(latestTimestampMs / 1000);
  if (latestSec > nowSec) {
    return {
      oracleTimestampSec: BigInt(nowSec),
      source: "current_time_future_point",
      latestPointSec: BigInt(latestSec),
    };
  }

  if (nowSec - latestSec > maxDelaySec) {
    return {
      oracleTimestampSec: BigInt(nowSec),
      source: "current_time_stale_point",
      latestPointSec: BigInt(latestSec),
    };
  }

  return {
    oracleTimestampSec: BigInt(latestSec),
    source: "latest_point",
    latestPointSec: BigInt(latestSec),
  };
};

