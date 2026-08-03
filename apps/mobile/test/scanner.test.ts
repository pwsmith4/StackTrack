import { describe, expect, it } from "vitest";
import { KeyboardWedgeScannerAdapter, UnitechIntentScannerAdapter } from "../src/scanner.js";

describe("scanner adapters", () => {
  it("normalizes keyboard-wedge scans and ignores input before start", async () => {
    const adapter = new KeyboardWedgeScannerAdapter();
    const observations: string[] = [];
    adapter.feed("  B1001  ");
    await adapter.start((observation) => observations.push(observation.rawValue));
    adapter.feed("  B1001  ", "code128");
    await adapter.stop();
    adapter.feed("B1002");

    expect(observations).toEqual(["B1001"]);
  });

  it("keeps the Unitech intent seam explicit", async () => {
    const adapter = new UnitechIntentScannerAdapter();
    const observation = new Promise<string>((resolve) => {
      void adapter.start((scan) => resolve(scan.rawValue));
    });
    adapter.handleIntent("C2002");

    await expect(observation).resolves.toBe("C2002");
    expect(adapter.kind).toBe("unitech_intent");
  });
});
