import { describe, expect, it } from "vitest";
import { canStartScanner } from "../src/scanner-availability.js";

describe("scanner availability", () => {
  const ready = {
    scannerEnabled: true,
    recordingAllowed: true,
    referenceDataReady: true,
    assignmentResolved: true
  } as const;

  it("allows capture when the approved list is temporarily unavailable but assignment is known", () => {
    expect(canStartScanner({ ...ready, referenceDataReady: false })).toBe(true);
  });

  it("keeps an explicitly disabled scanner stopped", () => {
    expect(canStartScanner({ ...ready, scannerEnabled: false })).toBe(false);
  });

  it("keeps a scanner with denied recording permission stopped", () => {
    expect(canStartScanner({ ...ready, recordingAllowed: false })).toBe(false);
  });

  it("requires an assignment when no approved list is available", () => {
    expect(canStartScanner({ ...ready, referenceDataReady: false, assignmentResolved: false })).toBe(false);
  });
});
