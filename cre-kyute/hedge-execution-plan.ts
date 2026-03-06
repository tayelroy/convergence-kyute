import type { HedgePolicyDecision } from "./hedge-policy.js";

export type HedgeExecutionAction = "OPEN_HEDGE" | "CLOSE_HEDGE" | "SKIP";

export type HedgeExecutionPlanInput = {
  decision: HedgePolicyDecision;
  proposedTargetHedgeNotionalWei: bigint;
  currentHedgeWei: bigint;
  hasExistingHedge: boolean;
  currentHedgeIsLong: boolean;
  rebalanceThresholdBp: bigint;
  minRebalanceDeltaWei: bigint;
  forceHedgeOverride?: boolean | null;
};

export type HedgeExecutionPlan = {
  shouldHedge: boolean;
  targetHedgeIsLong: boolean;
  targetHedgeNotionalWei: bigint;
  proposedDeltaWei: bigint;
  requiredDeltaWei: bigint;
  driftBelowThreshold: boolean;
  targetDeltaWei: bigint;
  hedgeAlreadyMatches: boolean;
  executeNeeded: boolean;
  action: HedgeExecutionAction;
};

const absDelta = (left: bigint, right: bigint): bigint =>
  left > right ? left - right : right - left;

export const buildHedgeExecutionPlan = (
  input: HedgeExecutionPlanInput,
): HedgeExecutionPlan => {
  const targetHedgeIsLong = input.decision.targetHedgeIsLong;
  let targetHedgeNotionalWei = input.proposedTargetHedgeNotionalWei;
  let shouldHedge = input.decision.shouldHedge && targetHedgeNotionalWei > 0n;

  if (input.forceHedgeOverride !== null && input.forceHedgeOverride !== undefined) {
    shouldHedge = input.forceHedgeOverride && targetHedgeNotionalWei > 0n;
  }

  if (!shouldHedge) {
    targetHedgeNotionalWei = 0n;
  }

  const proposedDeltaWei = absDelta(input.proposedTargetHedgeNotionalWei, input.currentHedgeWei);
  const bpThresholdWei = (input.currentHedgeWei * input.rebalanceThresholdBp) / 10_000n;
  const requiredDeltaWei =
    bpThresholdWei > input.minRebalanceDeltaWei ? bpThresholdWei : input.minRebalanceDeltaWei;

  const driftBelowThreshold =
    input.hasExistingHedge &&
    shouldHedge &&
    input.currentHedgeWei > 0n &&
    input.currentHedgeIsLong === targetHedgeIsLong &&
    proposedDeltaWei < requiredDeltaWei;

  if (driftBelowThreshold) {
    targetHedgeNotionalWei = input.currentHedgeWei;
  }

  const targetDeltaWei = absDelta(targetHedgeNotionalWei, input.currentHedgeWei);
  const hedgeAlreadyMatches =
    input.hasExistingHedge &&
    input.currentHedgeWei === targetHedgeNotionalWei &&
    input.currentHedgeIsLong === targetHedgeIsLong;
  const executeNeeded =
    (!shouldHedge && input.hasExistingHedge) ||
    (shouldHedge && (!input.hasExistingHedge || !hedgeAlreadyMatches));

  let action: HedgeExecutionAction = "SKIP";
  if (executeNeeded) {
    action = shouldHedge ? "OPEN_HEDGE" : "CLOSE_HEDGE";
  }

  return {
    shouldHedge,
    targetHedgeIsLong,
    targetHedgeNotionalWei,
    proposedDeltaWei,
    requiredDeltaWei,
    driftBelowThreshold,
    targetDeltaWei,
    hedgeAlreadyMatches,
    executeNeeded,
    action,
  };
};
