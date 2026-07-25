import type { AccuracyFlag, StoredEvent } from "./contracts.js";

export interface AccuracyThresholds {
  readonly clockWarningSeconds: number;
  readonly clockReviewSeconds: number;
  readonly clockVerificationMaxAgeSeconds: number;
  readonly staleReferenceDataSeconds: number;
}

export const defaultAccuracyThresholds: AccuracyThresholds = {
  clockWarningSeconds: 10 * 60,
  clockReviewSeconds: 24 * 60 * 60,
  clockVerificationMaxAgeSeconds: 7 * 24 * 60 * 60,
  staleReferenceDataSeconds: 7 * 24 * 60 * 60
};

export function effectiveEventAt(
  eventAt: string,
  deviceClockOffsetSeconds: number | undefined
): string {
  if (deviceClockOffsetSeconds === undefined) {
    return eventAt;
  }

  return new Date(
    Date.parse(eventAt) + deviceClockOffsetSeconds * 1_000
  ).toISOString();
}

export function assessClock(
  deviceClockOffsetSeconds: number | undefined,
  clockVerifiedAt: string | undefined,
  eventAt: string,
  thresholds: AccuracyThresholds = defaultAccuracyThresholds
): AccuracyFlag[] {
  if (deviceClockOffsetSeconds === undefined || !clockVerifiedAt) {
    return [];
  }

  const flags: AccuracyFlag[] = [];
  const differenceSeconds = Math.abs(deviceClockOffsetSeconds);

  if (differenceSeconds > thresholds.clockReviewSeconds) {
    flags.push("ClockSkewWarning", "ClockSkewReview");
  } else if (differenceSeconds > thresholds.clockWarningSeconds) {
    flags.push("ClockSkewWarning");
  }

  const effectiveAt = effectiveEventAt(eventAt, deviceClockOffsetSeconds);
  const verificationAgeSeconds =
    (Date.parse(effectiveAt) - Date.parse(clockVerifiedAt)) / 1_000;
  if (verificationAgeSeconds > thresholds.clockVerificationMaxAgeSeconds) {
    flags.push("ClockVerificationStale");
  }

  return flags;
}

export function assessReferenceData(
  referenceDataVersion: string | undefined,
  receivedAt: string,
  thresholds: AccuracyThresholds = defaultAccuracyThresholds
): AccuracyFlag[] {
  if (!referenceDataVersion) {
    return [];
  }

  const ageSeconds =
    (Date.parse(receivedAt) - Date.parse(referenceDataVersion)) / 1_000;

  return ageSeconds > thresholds.staleReferenceDataSeconds
    ? ["StaleReferenceData"]
    : [];
}

export function assessSequence(
  event: Pick<
    StoredEvent,
    "deviceSequence" | "deviceInstallationId" | "eventId"
  >,
  installationEvents: readonly StoredEvent[]
): AccuracyFlag[] {
  if (installationEvents.length === 0) {
    return event.deviceSequence > 0 ? ["DeviceSequenceGap"] : [];
  }

  const sameSequence = installationEvents.find(
    (existing) => existing.deviceSequence === event.deviceSequence
  );
  if (sameSequence && sameSequence.eventId !== event.eventId) {
    return ["DeviceSequenceCollision"];
  }

  const highestSequence = Math.max(
    ...installationEvents.map((existing) => existing.deviceSequence)
  );

  if (event.deviceSequence < highestSequence) {
    return ["DeviceSequenceOutOfOrder"];
  }

  if (event.deviceSequence > highestSequence + 1) {
    return ["DeviceSequenceGap"];
  }

  return [];
}

export function isReviewFlag(flag: AccuracyFlag): boolean {
  return flag === "ClockSkewReview" || flag === "DeviceSequenceCollision";
}
