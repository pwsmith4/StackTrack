import type { AccuracyFlag, StoredEvent } from "./contracts.js";

export type LoadState = "unknown" | "empty" | "loaded";
export type ProjectionHealth = "clean" | "warning" | "needs_review";

export type ConflictReason =
  | "ContainerAlreadyLoaded"
  | "ContainerAlreadyEmpty"
  | "CompetingLocationObservations"
  | "AccuracyEvidenceRequiresReview"
  | "LocationChangeWithoutDeparture"
  | "RepeatedDepartureBeforeArrival"
  | "ProcessingWithoutReceipt";

export interface ProjectionConflict {
  readonly conflictId: string;
  readonly reason: ConflictReason;
  readonly eventIds: readonly string[];
  readonly detectedAt: string;
}

export interface ContainerProjection {
  readonly tenantId: string;
  readonly containerId: string;
  readonly loadState: LoadState;
  readonly activeLoadCodeId: string | null;
  readonly locationId: string | null;
  readonly health: ProjectionHealth;
  readonly warnings: readonly AccuracyFlag[];
  readonly appliedEventIds: readonly string[];
  readonly conflicts: readonly ProjectionConflict[];
  readonly lastObservedAt: string | null;
  readonly lastEffectiveAt: string | null;
  readonly lastReceivedAt: string | null;
}

export interface ProjectionOptions {
  readonly competingObservationSeconds: number;
}

const defaultOptions: ProjectionOptions = {
  competingObservationSeconds: 120
};

function eventOrder(left: StoredEvent, right: StoredEvent): number {
  return (
    Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt) ||
    Date.parse(left.receivedAt) - Date.parse(right.receivedAt) ||
    left.eventId.localeCompare(right.eventId)
  );
}

function conflictId(reason: ConflictReason, eventIds: readonly string[]): string {
  return `${reason}:${[...eventIds].sort().join(":")}`;
}

function isLocationObservation(event: StoredEvent): boolean {
  return event.eventType === "batch_in" || event.eventType === "batch_out";
}

function isPhysicalEvidence(event: StoredEvent): boolean {
  return (
    event.eventType === "load_assigned" ||
    event.eventType === "batch_in" ||
    event.eventType === "emptied"
  );
}

export function projectContainer(
  sourceEvents: readonly StoredEvent[],
  options: ProjectionOptions = defaultOptions
): ContainerProjection | null {
  if (sourceEvents.length === 0) {
    return null;
  }

  const events = [...sourceEvents].sort(eventOrder);
  const first = events[0];
  if (!first) {
    return null;
  }

  let loadState: LoadState = "unknown";
  let activeLoadCodeId: string | null = null;
  let locationId: string | null = null;
  let lastAppliedLocationEvent: StoredEvent | undefined;
  // The last physical checkpoint is intentionally separate from the last
  // location observation. A load or empty scan establishes a physical site;
  // a later receipt at another site without a batch-out is an unannounced
  // handoff, not a reason to discard the newer arrival evidence.
  let lastPhysicalEvidence: StoredEvent | undefined;
  const appliedEventIds: string[] = [];
  const conflicts: ProjectionConflict[] = [];
  const warningSet = new Set<AccuracyFlag>();

  const addConflict = (
    reason: ConflictReason,
    eventIds: readonly string[],
    detectedAt: string
  ): void => {
    const id = conflictId(reason, eventIds);
    if (!conflicts.some((conflict) => conflict.conflictId === id)) {
      conflicts.push({ conflictId: id, reason, eventIds, detectedAt });
    }
  };

  const noteUnannouncedLocationChange = (event: StoredEvent): void => {
    if (!isPhysicalEvidence(event) || !lastPhysicalEvidence) return;
    if (lastPhysicalEvidence.locationId === event.locationId) return;
    if (lastAppliedLocationEvent?.eventType === "batch_out") return;
    addConflict(
      "LocationChangeWithoutDeparture",
      [lastPhysicalEvidence.eventId, event.eventId],
      event.receivedAt
    );
  };

  const noteProcessingWithoutReceipt = (event: StoredEvent): void => {
    if (event.eventType !== "emptied") return;
    if (loadState !== "loaded") return;
    if (lastAppliedLocationEvent?.eventType !== "batch_out") return;
    if (!lastPhysicalEvidence || lastPhysicalEvidence.locationId === event.locationId) return;
    addConflict(
      "ProcessingWithoutReceipt",
      [lastAppliedLocationEvent.eventId, event.eventId],
      event.receivedAt
    );
  };

  for (const event of events) {
    for (const flag of event.accuracyFlags) {
      warningSet.add(flag);
      if (
        flag === "ClockSkewReview" ||
        flag === "DeviceSequenceCollision"
      ) {
        addConflict("AccuracyEvidenceRequiresReview", [event.eventId], event.receivedAt);
      }
    }

    if (event.eventType === "load_assigned") {
      if (loadState === "loaded") {
        const priorId = appliedEventIds.at(-1);
        addConflict(
          "ContainerAlreadyLoaded",
          priorId ? [priorId, event.eventId] : [event.eventId],
          event.receivedAt
        );
        // A second load scan at another site is still useful physical
        // evidence. Apply that newer location/load while preserving the
        // double-load conflict so the operator can reconcile the missing
        // handoff instead of leaving the container stranded at its old site.
        noteUnannouncedLocationChange(event);
        if (lastPhysicalEvidence?.locationId !== event.locationId) {
          activeLoadCodeId = event.loadCodeId ?? activeLoadCodeId;
          locationId = event.locationId;
          appliedEventIds.push(event.eventId);
          lastPhysicalEvidence = event;
        }
        continue;
      }
      loadState = "loaded";
      activeLoadCodeId = event.loadCodeId ?? null;
      locationId = event.locationId;
      appliedEventIds.push(event.eventId);
      lastPhysicalEvidence = event;
      continue;
    }

    if (event.eventType === "emptied") {
      if (loadState !== "loaded") {
        const priorId = appliedEventIds.at(-1);
        addConflict(
          "ContainerAlreadyEmpty",
          priorId ? [priorId, event.eventId] : [event.eventId],
          event.receivedAt
        );
        // Even an already-empty container can provide the first trustworthy
        // evidence that it is now at a different site. Keep that location,
        // but flag the missing departure when no handoff was recorded.
        noteUnannouncedLocationChange(event);
        if (lastPhysicalEvidence?.locationId !== event.locationId) {
          locationId = event.locationId;
          appliedEventIds.push(event.eventId);
          lastPhysicalEvidence = event;
        }
        continue;
      }
      noteProcessingWithoutReceipt(event);
      noteUnannouncedLocationChange(event);
      loadState = "empty";
      activeLoadCodeId = null;
      locationId = event.locationId;
      appliedEventIds.push(event.eventId);
      lastPhysicalEvidence = event;
      continue;
    }

    if (isLocationObservation(event)) {
      if (
        event.eventType === "batch_out" &&
        lastAppliedLocationEvent?.eventType === "batch_out"
      ) {
        addConflict(
          "RepeatedDepartureBeforeArrival",
          [lastAppliedLocationEvent.eventId, event.eventId],
          event.receivedAt
        );
      }
      if (event.eventType === "batch_in") noteUnannouncedLocationChange(event);

      if (
        lastAppliedLocationEvent &&
        lastAppliedLocationEvent.eventType === event.eventType &&
        lastAppliedLocationEvent.deviceId !== event.deviceId &&
        lastAppliedLocationEvent.locationId !== event.locationId &&
        Math.abs(
          Date.parse(event.effectiveAt) -
            Date.parse(lastAppliedLocationEvent.effectiveAt)
        ) /
          1_000 <=
          options.competingObservationSeconds
      ) {
        addConflict(
          "CompetingLocationObservations",
          [lastAppliedLocationEvent.eventId, event.eventId],
          event.receivedAt
        );
        continue;
      }

      locationId = event.locationId;
      lastAppliedLocationEvent = event;
      appliedEventIds.push(event.eventId);
      if (event.eventType === "batch_in") {
        lastPhysicalEvidence = event;
      }
    }
  }

  const warnings = [...warningSet];
  const health: ProjectionHealth =
    conflicts.length > 0
      ? "needs_review"
      : warnings.length > 0
        ? "warning"
        : "clean";
  const lastEvent = events.at(-1);

  return {
    tenantId: first.tenantId,
    containerId: first.containerId,
    loadState,
    activeLoadCodeId,
    locationId,
    health,
    warnings,
    appliedEventIds,
    conflicts,
    lastObservedAt: lastEvent?.eventAt ?? null,
    lastEffectiveAt: lastEvent?.effectiveAt ?? null,
    lastReceivedAt: lastEvent?.receivedAt ?? null
  };
}
