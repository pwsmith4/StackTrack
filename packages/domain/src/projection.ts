import type { AccuracyFlag, StoredEvent } from "./contracts.js";

export type LoadState = "unknown" | "empty" | "loaded";
export type ProjectionHealth = "clean" | "warning" | "needs_review";

export type ConflictReason =
  | "ContainerAlreadyLoaded"
  | "ContainerAlreadyEmpty"
  | "CompetingLocationObservations"
  | "AccuracyEvidenceRequiresReview";

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

  for (const event of events) {
    for (const flag of event.accuracyFlags) {
      warningSet.add(flag);
      if (flag === "ClockSkewReview" || flag === "DeviceSequenceCollision") {
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
        continue;
      }
      loadState = "loaded";
      activeLoadCodeId = event.loadCodeId ?? null;
      locationId = event.locationId;
      appliedEventIds.push(event.eventId);
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
        continue;
      }
      loadState = "empty";
      activeLoadCodeId = null;
      locationId = event.locationId;
      appliedEventIds.push(event.eventId);
      continue;
    }

    if (isLocationObservation(event)) {
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
