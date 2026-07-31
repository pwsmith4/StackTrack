export const API_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:3000";

export const TENANT_ID = "10000000-0000-4000-8000-000000000001";

export interface Location {
  locationId: string;
  name: string;
  type: "donation_express" | "store_backroom" | "warehouse" | "in_transit";
}

export interface Device {
  deviceId: string;
  installationId: string;
  label: string;
  assignedLocationId: string;
  isActive: boolean;
  deactivatedAt: string | null;
  pendingOfflineScanCount?: number;
  reportedAppVersion: string | null;
  requiredAppVersion?: string;
  lastReportedAt: string | null;
}

export interface DeviceAssignment {
  assignmentHistoryId: string;
  deviceId: string;
  previousLocationId: string | null;
  assignedLocationId: string;
  reason: string;
  occurredAt: string;
}

export interface Container {
  containerId: string;
  label: string;
  type: "bin" | "cart" | "gaylord";
}

export interface Fixtures {
  tenant: { tenantId: string; name: string };
  locations: Location[];
  devices: Device[];
  deviceAssignments: DeviceAssignment[];
  containers: Container[];
  goodsTypes: { name: string; secondaryLabel: string; options: string[] }[];
}

export interface StoredEvent {
  eventId: string;
  deviceId: string;
  deviceInstallationId: string;
  deviceSequence: number;
  containerId: string;
  loadCodeId?: string | null;
  locationId: string;
  eventType: "load_assigned" | "batch_out" | "batch_in" | "emptied";
  eventAt: string;
  effectiveAt: string;
  receivedAt: string;
  accuracyFlags: string[];
  payload: Record<string, unknown>;
}

export interface Projection {
  containerId: string;
  loadState: "unknown" | "empty" | "loaded";
  activeLoadCodeId: string | null;
  locationId: string | null;
  health: "clean" | "warning" | "needs_review";
  warnings: string[];
  appliedEventIds: string[];
  conflicts: { conflictId: string; reason: string; eventIds: string[]; detectedAt: string }[];
  lastObservedAt: string | null;
  lastReceivedAt: string | null;
}

const headers = { "x-stacktrack-tenant-id": TENANT_ID };

async function getJson<T>(path: string): Promise<T> {
  const joiner = path.includes("?") ? "&" : "?";
  const response = await fetch(`${API_URL}${path}${joiner}refresh=${Date.now()}`, {
    headers: { ...headers, "cache-control": "no-cache" }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function updateDevice(
  deviceId: string,
  update: {
    assignedLocationId?: string;
    isActive?: boolean;
    assignmentReason?: string;
  }
): Promise<Device> {
  const response = await patchJson<{ device: Device }>(`/api/v1/local/devices/${deviceId}`, update);
  return response.device;
}

export async function loadOperationsData() {
  const fixtures = await getJson<Fixtures>("/api/v1/local/reference-data");
  const [eventsResult, statesResult] = await Promise.all([
    getJson<{ items: StoredEvent[] }>("/api/v1/local/events"),
    getJson<{ items: Projection[] }>("/api/v1/containers/states")
  ]);
  const projectionById = new Map(
    statesResult.items.map((projection) => [projection.containerId, projection])
  );
  return {
    fixtures,
    events: eventsResult.items,
    projections: Object.fromEntries(
      fixtures.containers.map((container) => [
        container.containerId,
        projectionById.get(container.containerId) ?? null
      ])
    ) as Record<string, Projection | null>
  };
}
