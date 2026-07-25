export interface ClockEstimate {
  readonly offsetSeconds: number;
  readonly verifiedAt: string;
  readonly roundTripMilliseconds: number;
  readonly usable: boolean;
}

export function estimateClockOffset(
  deviceSentAt: string,
  serverAt: string,
  deviceReceivedAt: string,
  maximumRoundTripMilliseconds = 10_000
): ClockEstimate {
  const sent = Date.parse(deviceSentAt);
  const server = Date.parse(serverAt);
  const received = Date.parse(deviceReceivedAt);

  if (![sent, server, received].every(Number.isFinite) || received < sent) {
    throw new Error("Clock estimate requires a valid, non-negative round trip.");
  }

  const roundTripMilliseconds = received - sent;
  const deviceMidpoint = sent + roundTripMilliseconds / 2;

  return {
    offsetSeconds: (server - deviceMidpoint) / 1_000,
    verifiedAt: serverAt,
    roundTripMilliseconds,
    usable: roundTripMilliseconds <= maximumRoundTripMilliseconds
  };
}

