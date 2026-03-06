import { describe, expect, test } from "bun:test";
import { resolveFreshOracleTimestamp } from "./oracle-timestamp.js";

describe("resolveFreshOracleTimestamp", () => {
  test("uses latest point when it is still fresh", () => {
    const nowMs = 1_000_000;
    const resolution = resolveFreshOracleTimestamp(800_000, {
      nowMs,
      maxDelaySec: 300,
    });

    expect(resolution.source).toBe("latest_point");
    expect(resolution.oracleTimestampSec).toBe(800n);
    expect(resolution.latestPointSec).toBe(800n);
  });

  test("clamps stale latest point to current time", () => {
    const nowMs = 1_000_000;
    const resolution = resolveFreshOracleTimestamp(100_000, {
      nowMs,
      maxDelaySec: 300,
    });

    expect(resolution.source).toBe("current_time_stale_point");
    expect(resolution.oracleTimestampSec).toBe(1000n);
    expect(resolution.latestPointSec).toBe(100n);
  });

  test("uses current time when no point exists", () => {
    const resolution = resolveFreshOracleTimestamp(null, {
      nowMs: 1_000_000,
    });

    expect(resolution.source).toBe("current_time_no_point");
    expect(resolution.oracleTimestampSec).toBe(1000n);
    expect(resolution.latestPointSec).toBeNull();
  });
});

