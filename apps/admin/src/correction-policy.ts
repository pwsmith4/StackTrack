export type CorrectionField =
  | "goodsType"
  | "secondaryValue"
  | "notes"
  | "location"
  | "processedPercentage"
  | "conflictResolution"
  | "reportedPeriod";

export type CorrectionImpact = "routine" | "material";
export type ApprovalRole = "store_manager" | "corporate_data_steward";

const materialFields = new Set<CorrectionField>([
  "location",
  "processedPercentage",
  "conflictResolution",
  "reportedPeriod"
]);

export interface CorrectionPolicyResult {
  readonly impact: CorrectionImpact;
  readonly requiredRole: ApprovalRole;
  readonly requiresSeparateApprover: boolean;
}

export function classifyCorrection(
  fields: readonly CorrectionField[]
): CorrectionPolicyResult {
  const impact: CorrectionImpact = fields.some((field) => materialFields.has(field))
    ? "material"
    : "routine";

  return impact === "material"
    ? {
        impact,
        requiredRole: "corporate_data_steward",
        requiresSeparateApprover: true
      }
    : {
        impact,
        requiredRole: "store_manager",
        requiresSeparateApprover: false
      };
}

