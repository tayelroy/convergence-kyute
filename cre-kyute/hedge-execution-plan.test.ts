import { describe, expect, test } from "bun:test";
import { computeHedgePolicy } from "./hedge-policy.js";
import { buildHedgeExecutionPlan } from "./hedge-execution-plan.js";

const DEFAULT_REBALANCE_THRESHOLD_BP = 100n;
const DEFAULT_MIN_REBALANCE_DELTA_WEI = 10_000_000_000_000_000n;
const ONE_ETH = 1_000_000_000_000_000_000n;

describe("buildHedgeExecutionPlan", () => {
  test("opens Strategy 1 when pay_floating exposure is attractive", () => {
    const decision = computeHedgePolicy({
      positionSide: "long",
      averageFundingBp: 620,
      borosImpliedAprBp: 500,
      confidenceBp: 10_000,
      hasExistingHedge: false,
      existingHedgeIsLong: false,
      entryThresholdBp: 40,
      exitThresholdBp: 10,
      minConfidenceBp: 6_000,
      oiFeeBp: 10,
      mode: "adverse_only",
    });
    const plan = buildHedgeExecutionPlan({
      decision,
      proposedTargetHedgeNotionalWei: ONE_ETH,
      currentHedgeWei: 0n,
      hasExistingHedge: false,
      currentHedgeIsLong: false,
      rebalanceThresholdBp: DEFAULT_REBALANCE_THRESHOLD_BP,
      minRebalanceDeltaWei: DEFAULT_MIN_REBALANCE_DELTA_WEI,
      forceHedgeOverride: null,
    });

    expect(plan.shouldHedge).toBe(true);
    expect(plan.targetHedgeIsLong).toBe(true);
    expect(plan.targetHedgeNotionalWei).toBe(ONE_ETH);
    expect(plan.executeNeeded).toBe(true);
    expect(plan.action).toBe("OPEN_HEDGE");
  });

  test("closes Strategy 1 when funding goes flat", () => {
    const decision = computeHedgePolicy({
      positionSide: "long",
      averageFundingBp: 0,
      borosImpliedAprBp: 500,
      confidenceBp: 10_000,
      hasExistingHedge: true,
      existingHedgeIsLong: true,
      entryThresholdBp: 40,
      exitThresholdBp: 10,
      minConfidenceBp: 6_000,
      oiFeeBp: 10,
      mode: "adverse_only",
    });
    const plan = buildHedgeExecutionPlan({
      decision,
      proposedTargetHedgeNotionalWei: ONE_ETH,
      currentHedgeWei: ONE_ETH,
      hasExistingHedge: true,
      currentHedgeIsLong: true,
      rebalanceThresholdBp: DEFAULT_REBALANCE_THRESHOLD_BP,
      minRebalanceDeltaWei: DEFAULT_MIN_REBALANCE_DELTA_WEI,
      forceHedgeOverride: null,
    });

    expect(plan.shouldHedge).toBe(false);
    expect(plan.targetHedgeNotionalWei).toBe(0n);
    expect(plan.executeNeeded).toBe(true);
    expect(plan.action).toBe("CLOSE_HEDGE");
  });

  test("opens Strategy 2 when receive_floating lock is selected", () => {
    const decision = computeHedgePolicy({
      positionSide: "long",
      averageFundingBp: -803,
      borosImpliedAprBp: 458,
      confidenceBp: 10_000,
      hasExistingHedge: false,
      existingHedgeIsLong: false,
      entryThresholdBp: 40,
      exitThresholdBp: 10,
      minConfidenceBp: 6_000,
      oiFeeBp: 10,
      mode: "lock_fixed",
    });
    const plan = buildHedgeExecutionPlan({
      decision,
      proposedTargetHedgeNotionalWei: ONE_ETH,
      currentHedgeWei: 0n,
      hasExistingHedge: false,
      currentHedgeIsLong: false,
      rebalanceThresholdBp: DEFAULT_REBALANCE_THRESHOLD_BP,
      minRebalanceDeltaWei: DEFAULT_MIN_REBALANCE_DELTA_WEI,
      forceHedgeOverride: null,
    });

    expect(plan.shouldHedge).toBe(true);
    expect(plan.targetHedgeIsLong).toBe(false);
    expect(plan.targetHedgeNotionalWei).toBe(ONE_ETH);
    expect(plan.executeNeeded).toBe(true);
    expect(plan.action).toBe("OPEN_HEDGE");
  });

  test("closes Strategy 2 when funding goes flat", () => {
    const decision = computeHedgePolicy({
      positionSide: "long",
      averageFundingBp: 0,
      borosImpliedAprBp: 458,
      confidenceBp: 10_000,
      hasExistingHedge: true,
      existingHedgeIsLong: false,
      entryThresholdBp: 40,
      exitThresholdBp: 10,
      minConfidenceBp: 6_000,
      oiFeeBp: 10,
      mode: "lock_fixed",
    });
    const plan = buildHedgeExecutionPlan({
      decision,
      proposedTargetHedgeNotionalWei: ONE_ETH,
      currentHedgeWei: ONE_ETH,
      hasExistingHedge: true,
      currentHedgeIsLong: false,
      rebalanceThresholdBp: DEFAULT_REBALANCE_THRESHOLD_BP,
      minRebalanceDeltaWei: DEFAULT_MIN_REBALANCE_DELTA_WEI,
      forceHedgeOverride: null,
    });

    expect(plan.shouldHedge).toBe(false);
    expect(plan.targetHedgeNotionalWei).toBe(0n);
    expect(plan.executeNeeded).toBe(true);
    expect(plan.action).toBe("CLOSE_HEDGE");
  });

  test("zero-size HL position closes an existing Boros hedge", () => {
    const decision = computeHedgePolicy({
      positionSide: "long",
      averageFundingBp: 620,
      borosImpliedAprBp: 500,
      confidenceBp: 10_000,
      hasExistingHedge: true,
      existingHedgeIsLong: true,
      entryThresholdBp: 40,
      exitThresholdBp: 10,
      minConfidenceBp: 6_000,
      oiFeeBp: 10,
      mode: "adverse_only",
    });
    const plan = buildHedgeExecutionPlan({
      decision,
      proposedTargetHedgeNotionalWei: 0n,
      currentHedgeWei: ONE_ETH,
      hasExistingHedge: true,
      currentHedgeIsLong: true,
      rebalanceThresholdBp: DEFAULT_REBALANCE_THRESHOLD_BP,
      minRebalanceDeltaWei: DEFAULT_MIN_REBALANCE_DELTA_WEI,
      forceHedgeOverride: null,
    });

    expect(decision.shouldHedge).toBe(true);
    expect(plan.shouldHedge).toBe(false);
    expect(plan.targetHedgeNotionalWei).toBe(0n);
    expect(plan.executeNeeded).toBe(true);
    expect(plan.action).toBe("CLOSE_HEDGE");
  });
});
