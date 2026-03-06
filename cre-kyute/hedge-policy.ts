export type PositionSide = "long" | "short";
export type HedgeMode = "adverse_only" | "lock_fixed";
export type FloatingExposure = "pay_floating" | "receive_floating" | "flat";

export type HedgePolicyInput = {
  positionSide: PositionSide;
  averageFundingBp: number;
  borosImpliedAprBp: number;
  confidenceBp: number;
  hasExistingHedge: boolean;
  existingHedgeIsLong: boolean;
  entryThresholdBp: number;
  exitThresholdBp: number;
  minConfidenceBp: number;
  oiFeeBp?: number;
  mode?: HedgeMode;
};

export type HedgePolicyDecision = {
  exposure: FloatingExposure;
  shouldHedge: boolean;
  targetHedgeIsLong: boolean;
  floatingAprBp: number;
  borosImpliedAprBp: number;
  effectiveFixedPayAprBp: number;
  effectiveFixedReceiveAprBp: number;
  carrySourceAprBp: number;
  carryCostAprBp: number;
  edgeBp: number;
  confidenceOk: boolean;
  reason: string;
};

type HedgeCandidate = {
  shouldHedge: boolean;
  targetHedgeIsLong: boolean;
  carrySourceAprBp: number;
  carryCostAprBp: number;
  edgeBp: number;
  reason: string;
};

export const getFloatingExposure = (
  positionSide: PositionSide,
  averageFundingBp: number,
): { exposure: FloatingExposure; floatingAprBp: number } => {
  if (!Number.isFinite(averageFundingBp) || averageFundingBp === 0) {
    return { exposure: "flat", floatingAprBp: 0 };
  }

  const longsPay = averageFundingBp > 0;
  const payingFloating =
    (positionSide === "long" && longsPay) ||
    (positionSide === "short" && !longsPay);

  return {
    exposure: payingFloating ? "pay_floating" : "receive_floating",
    floatingAprBp: Math.abs(averageFundingBp),
  };
};

const evaluateCandidate = (input: {
  floatingAprBp: number;
  carrySourceAprBp: number;
  carryCostAprBp: number;
  entryThresholdBp: number;
  exitThresholdBp: number;
  confidenceOk: boolean;
  hasExistingMatchingHedge: boolean;
  targetHedgeIsLong: boolean;
  label: string;
}): HedgeCandidate => {
  const edgeBp = input.carrySourceAprBp - input.carryCostAprBp;
  const thresholdBp = input.hasExistingMatchingHedge
    ? input.exitThresholdBp
    : input.entryThresholdBp;
  const shouldHedge =
    input.confidenceOk &&
    edgeBp >= thresholdBp &&
    input.carrySourceAprBp > input.carryCostAprBp;

  return {
    shouldHedge,
    targetHedgeIsLong: input.targetHedgeIsLong,
    carrySourceAprBp: input.carrySourceAprBp,
    carryCostAprBp: input.carryCostAprBp,
    edgeBp,
    reason:
      `${input.label} edge=${edgeBp}bp threshold=${thresholdBp}bp ` +
      `source=${input.carrySourceAprBp}bp cost=${input.carryCostAprBp}bp confidenceOk=${input.confidenceOk}`,
  };
};

export const computeHedgePolicy = (
  input: HedgePolicyInput,
): HedgePolicyDecision => {
  const exposure = getFloatingExposure(input.positionSide, input.averageFundingBp);
  const mode = input.mode ?? "adverse_only";
  const oiFeeBp = input.oiFeeBp ?? 10;
  const confidenceOk = input.confidenceBp >= input.minConfidenceBp;
  const effectiveFixedPayAprBp = input.borosImpliedAprBp + oiFeeBp;
  const effectiveFixedReceiveAprBp = Math.max(
    0,
    input.borosImpliedAprBp - oiFeeBp,
  );

  const longCandidate = evaluateCandidate({
    floatingAprBp: exposure.floatingAprBp,
    carrySourceAprBp: exposure.floatingAprBp,
    carryCostAprBp: effectiveFixedPayAprBp,
    entryThresholdBp: input.entryThresholdBp,
    exitThresholdBp: input.exitThresholdBp,
    confidenceOk,
    hasExistingMatchingHedge: input.hasExistingHedge && input.existingHedgeIsLong,
    targetHedgeIsLong: true,
    label: "long_yu_pay_fixed_receive_floating",
  });

  if (exposure.exposure === "pay_floating") {
    return {
      exposure: exposure.exposure,
      shouldHedge: longCandidate.shouldHedge,
      targetHedgeIsLong: true,
      floatingAprBp: exposure.floatingAprBp,
      borosImpliedAprBp: input.borosImpliedAprBp,
      effectiveFixedPayAprBp,
      effectiveFixedReceiveAprBp,
      carrySourceAprBp: longCandidate.carrySourceAprBp,
      carryCostAprBp: longCandidate.carryCostAprBp,
      edgeBp: longCandidate.edgeBp,
      confidenceOk,
      reason: longCandidate.reason,
    };
  }

  if (exposure.exposure === "receive_floating" && mode === "lock_fixed") {
    const shortCandidate = evaluateCandidate({
      floatingAprBp: exposure.floatingAprBp,
      carrySourceAprBp: effectiveFixedReceiveAprBp,
      carryCostAprBp: exposure.floatingAprBp,
      entryThresholdBp: input.entryThresholdBp,
      exitThresholdBp: input.exitThresholdBp,
      confidenceOk,
      hasExistingMatchingHedge: input.hasExistingHedge && !input.existingHedgeIsLong,
      targetHedgeIsLong: false,
      label: "short_yu_receive_fixed_pay_floating",
    });
    return {
      exposure: exposure.exposure,
      shouldHedge: shortCandidate.shouldHedge,
      targetHedgeIsLong: false,
      floatingAprBp: exposure.floatingAprBp,
      borosImpliedAprBp: input.borosImpliedAprBp,
      effectiveFixedPayAprBp,
      effectiveFixedReceiveAprBp,
      carrySourceAprBp: shortCandidate.carrySourceAprBp,
      carryCostAprBp: shortCandidate.carryCostAprBp,
      edgeBp: shortCandidate.edgeBp,
      confidenceOk,
      reason: shortCandidate.reason,
    };
  }

  return {
    exposure: exposure.exposure,
    shouldHedge: false,
    targetHedgeIsLong: input.hasExistingHedge ? input.existingHedgeIsLong : true,
    floatingAprBp: exposure.floatingAprBp,
    borosImpliedAprBp: input.borosImpliedAprBp,
    effectiveFixedPayAprBp,
    effectiveFixedReceiveAprBp,
    carrySourceAprBp: exposure.floatingAprBp,
    carryCostAprBp:
      exposure.exposure === "receive_floating"
        ? effectiveFixedReceiveAprBp
        : effectiveFixedPayAprBp,
    edgeBp:
      exposure.exposure === "receive_floating"
        ? effectiveFixedReceiveAprBp - exposure.floatingAprBp
        : exposure.floatingAprBp - effectiveFixedPayAprBp,
    confidenceOk,
    reason:
      exposure.exposure === "receive_floating"
        ? "receive_floating exposure left unhedged in adverse_only mode"
        : "flat funding exposure",
  };
};
