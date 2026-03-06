import { describe, expect, test } from "bun:test";
import { computeHedgePolicy } from "./hedge-policy.js";

describe("computeHedgePolicy", () => {
  test("opens long YU for pay_floating exposure in adverse_only mode", () => {
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

    expect(decision.exposure).toBe("pay_floating");
    expect(decision.shouldHedge).toBe(true);
    expect(decision.targetHedgeIsLong).toBe(true);
    expect(decision.carrySourceAprBp).toBe(620);
    expect(decision.carryCostAprBp).toBe(510);
    expect(decision.edgeBp).toBe(110);
    expect(decision.reason).toContain("long_yu_pay_fixed_receive_floating");
  });

  test("existing long YU hedge uses exit threshold instead of entry threshold", () => {
    const newHedgeDecision = computeHedgePolicy({
      positionSide: "long",
      averageFundingBp: 530,
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
    const existingHedgeDecision = computeHedgePolicy({
      positionSide: "long",
      averageFundingBp: 530,
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

    expect(newHedgeDecision.exposure).toBe("pay_floating");
    expect(newHedgeDecision.edgeBp).toBe(20);
    expect(newHedgeDecision.shouldHedge).toBe(false);

    expect(existingHedgeDecision.exposure).toBe("pay_floating");
    expect(existingHedgeDecision.edgeBp).toBe(20);
    expect(existingHedgeDecision.shouldHedge).toBe(true);
    expect(existingHedgeDecision.targetHedgeIsLong).toBe(true);
    expect(existingHedgeDecision.reason).toContain("threshold=10bp");
  });

  test("flat funding closes an existing long YU hedge", () => {
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

    expect(decision.exposure).toBe("flat");
    expect(decision.shouldHedge).toBe(false);
    expect(decision.targetHedgeIsLong).toBe(true);
    expect(decision.edgeBp).toBe(-510);
    expect(decision.reason).toBe("flat funding exposure");
  });

  test("opens short YU for receive_floating exposure in lock_fixed mode", () => {
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

    expect(decision.exposure).toBe("receive_floating");
    expect(decision.shouldHedge).toBe(true);
    expect(decision.targetHedgeIsLong).toBe(false);
    expect(decision.carrySourceAprBp).toBe(448);
    expect(decision.carryCostAprBp).toBe(0);
    expect(decision.edgeBp).toBe(448);
    expect(decision.reason).toContain("short_yu_lock_fixed_receive_fixed");
  });

  test("leaves receive_floating exposure unhedged in adverse_only mode", () => {
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
      mode: "adverse_only",
    });

    expect(decision.exposure).toBe("receive_floating");
    expect(decision.shouldHedge).toBe(false);
    expect(decision.targetHedgeIsLong).toBe(false);
    expect(decision.reason).toBe("receive_floating exposure left unhedged in adverse_only mode");
  });
});
