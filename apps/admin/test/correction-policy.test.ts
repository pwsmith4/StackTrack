import { describe, expect, it } from "vitest";
import { classifyCorrection } from "../src/index.js";

describe("classifyCorrection", () => {
  it("allows a store manager to make a routine classification correction", () => {
    expect(classifyCorrection(["goodsType", "notes"])).toEqual({
      impact: "routine",
      requiredRole: "store_manager",
      requiresSeparateApprover: false
    });
  });

  it("routes a location correction to a separate corporate approver", () => {
    expect(classifyCorrection(["location"])).toEqual({
      impact: "material",
      requiredRole: "corporate_data_steward",
      requiresSeparateApprover: true
    });
  });
});

