import { describe, expect, it } from "vitest";
import { resolveDeferredCapture } from "../src/deferred-observations.js";

const baseCapture = {
  localId: "77777777-7777-4777-8777-777777777777",
  label: "b1001",
  eventType: "batch_out" as const,
  eventAt: "2026-08-03T12:00:00.000Z",
  deviceSequence: 42,
  locationId: "66666666-6666-4666-8666-666666666666",
  originLocationId: "66666666-6666-4666-8666-666666666666"
};

describe("deferred offline captures", () => {
  it("resolves a label to the approved container and transit sentinel", () => {
    const result = resolveDeferredCapture(baseCapture, {
      containers: [{ containerId: "44444444-4444-4444-8444-444444444444", label: "B1001" }],
      transitLocationId: "66666666-6666-4666-8666-666666666667"
    }, { deviceInstallationId: "33333333-3333-4333-8333-333333333333" });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.containerId).toBe("44444444-4444-4444-8444-444444444444");
    expect(result.event).toMatchObject({
      containerId: "44444444-4444-4444-8444-444444444444",
      locationId: "66666666-6666-4666-8666-666666666667",
      eventType: "batch_out",
      payload: { sourceLocationId: "66666666-6666-4666-8666-666666666666" }
    });
  });

  it("does not invent a container ID for an unknown label", () => {
    const result = resolveDeferredCapture(baseCapture, {
      containers: [{ containerId: "44444444-4444-4444-8444-444444444444", label: "B1002" }]
    }, { deviceInstallationId: "33333333-3333-4333-8333-333333333333" });

    expect(result).toEqual({
      kind: "review",
      message: "The label B1001 was not found in the approved container list. An administrator needs to review it."
    });
  });
});
