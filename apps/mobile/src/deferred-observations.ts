export type DeferredAction = "load_assigned" | "batch_out" | "batch_in" | "emptied";

export interface DeferredCapture {
  readonly localId: string;
  readonly label: string;
  readonly eventType: DeferredAction;
  readonly eventAt: string;
  readonly deviceSequence: number;
  readonly locationId: string;
  readonly originLocationId?: string;
  readonly goodsType?: string;
  readonly secondaryValue?: string;
  readonly processedPercentage?: number;
  readonly loadCodeId?: string;
  readonly loadCode?: string;
  readonly referenceDataVersion?: string;
}

export interface DeferredContainerReference {
  readonly containerId: string;
  readonly label: string;
}

export interface DeferredReferenceData {
  readonly containers: readonly DeferredContainerReference[];
  /** The in-transit sentinel is returned by the API; it is never a user-selected destination. */
  readonly transitLocationId?: string;
}

export type DeferredResolution =
  | { readonly kind: "ready"; readonly containerId: string; readonly event: Record<string, unknown> }
  | { readonly kind: "review"; readonly message: string };

/**
 * Resolve a label-only capture once the approved container list is available.
 * This deliberately does not invent an ID: an unknown printed label is sent to
 * review instead of being written to the official ledger under a placeholder.
 */
export function resolveDeferredCapture(
  capture: DeferredCapture,
  referenceData: DeferredReferenceData,
  context: { readonly deviceInstallationId: string }
): DeferredResolution {
  const normalizedLabel = capture.label.trim().toUpperCase();
  const container = referenceData.containers.find(
    (candidate) => candidate.label.trim().toUpperCase() === normalizedLabel
  );
  if (!container) {
    return {
      kind: "review",
      message: `The label ${normalizedLabel || "entered on the scanner"} was not found in the approved container list. An administrator needs to review it.`
    };
  }

  if (capture.eventType === "load_assigned" && (!capture.loadCodeId || !capture.goodsType || !capture.secondaryValue)) {
    return {
      kind: "review",
      message: `The load details for ${normalizedLabel} were incomplete while the scanner was offline. An administrator needs to review it.`
    };
  }

  const eventAt = capture.eventAt;
  const payload = capture.eventType === "load_assigned"
    ? { displayLoadCode: capture.loadCode, goodsType: capture.goodsType, secondaryValue: capture.secondaryValue }
    : capture.eventType === "batch_out"
      ? { sourceLocationId: capture.originLocationId ?? capture.locationId }
      : capture.eventType === "emptied"
        ? { processedPercentage: capture.processedPercentage ?? 100 }
        : {};

  const event: Record<string, unknown> = {
    eventId: capture.localId,
    deviceInstallationId: context.deviceInstallationId,
    deviceSequence: capture.deviceSequence,
    containerId: container.containerId,
    ...(capture.loadCodeId ? { loadCodeId: capture.loadCodeId } : {}),
    locationId: capture.eventType === "batch_out"
      ? referenceData.transitLocationId ?? capture.locationId
      : capture.locationId,
    eventType: capture.eventType,
    eventAt,
    deviceClockOffsetSeconds: 0,
    clockVerifiedAt: eventAt,
    ...(capture.referenceDataVersion ? { referenceDataVersion: capture.referenceDataVersion } : {}),
    payload
  };
  return { kind: "ready", containerId: container.containerId, event };
}
