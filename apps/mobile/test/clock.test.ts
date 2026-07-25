import { describe, expect, it } from "vitest";
import { estimateClockOffset } from "../src/index.js";

describe("estimateClockOffset", () => {
  it("uses the request midpoint rather than mistaking network time for skew", () => {
    const estimate = estimateClockOffset(
      "2026-07-22T11:59:58.000Z",
      "2026-07-22T12:00:03.000Z",
      "2026-07-22T12:00:00.000Z"
    );

    expect(estimate.offsetSeconds).toBe(4);
    expect(estimate.roundTripMilliseconds).toBe(2_000);
    expect(estimate.usable).toBe(true);
  });

  it("does not trust a very slow handshake", () => {
    const estimate = estimateClockOffset(
      "2026-07-22T12:00:00.000Z",
      "2026-07-22T12:00:08.000Z",
      "2026-07-22T12:00:20.000Z"
    );

    expect(estimate.usable).toBe(false);
  });
});

