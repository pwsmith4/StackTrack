export const API_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:3000";

export const TENANT_ID = "10000000-0000-4000-8000-000000000001";

export class ApiRequestError extends Error {
  public constructor(readonly status: number, readonly path: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

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

export type AdminRole = "organization_owner" | "operations_administrator" | "read_only_reviewer" | "support";
export type ManagedAdminRole = Exclude<AdminRole, "support">;
export interface AdminPrincipal { tenantId: string; userId: string; username: string; displayName: string; role: AdminRole; supportExpiresAt: string | null; isActive: boolean; mustChangePassword: boolean; }
export interface AdminSession { token: string; principal: AdminPrincipal; expiresAt: string; }
export interface AuditEntry { auditId: string; occurredAt: string; actorType: "user" | "device" | "system"; actorDisplayName: string; action: string; targetType: string; targetId: string | null; details: Record<string, unknown>; }
export type ReviewAction = "assigned" | "approved" | "rejected" | "resolved" | "reopened";
export interface ReviewCase { reviewCaseId: string; containerId: string; containerLabel: string; reasonCode: string; evidenceEventIds: string[]; openedAt: string; status: "opened" | ReviewAction; lastActionAt: string | null; lastActionReason: string | null; actionCount: number; }
export interface OperationsWarning { endpoint: string; status: number | null; message: string; }

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
const readRetryDelaysMs = [750, 2_000, 5_000];
const retryableReadStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

function adminHeaders(session?: AdminSession | null) {
  return session ? { authorization: `Bearer ${session.token}` } : {};
}

async function readWithRetry(path: string, session: AdminSession): Promise<Response> {
  const joiner = path.includes("?") ? "&" : "?";
  const url = `${API_URL}${path}${joiner}refresh=${Date.now()}`;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { ...headers, ...adminHeaders(session), "cache-control": "no-cache" }
      });
      if (!retryableReadStatuses.has(response.status) || attempt >= readRetryDelaysMs.length) {
        return response;
      }
    } catch (error) {
      if (attempt >= readRetryDelaysMs.length) throw error;
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, readRetryDelaysMs[attempt]));
  }
}

async function getJson<T>(path: string, session: AdminSession): Promise<T> {
  const response = await readWithRetry(path, session);
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiRequestError(
      response.status,
      path,
      `GET ${path} failed (${response.status}): ${detail?.message ?? response.statusText}`
    );
  }
  return response.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown, session?: AdminSession | null): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { ...headers, ...adminHeaders(session), "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? `${response.status} ${response.statusText}`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export async function updateDevice(
  deviceId: string,
  update: {
    label?: string;
    assignedLocationId?: string;
    isActive?: boolean;
    assignmentReason?: string;
  },
  session: AdminSession
): Promise<Device> {
  const response = await patchJson<{ device: Device }>(`/api/v1/local/devices/${deviceId}`, update, session);
  return response.device;
}

export async function signIn(username: string, password: string): Promise<AdminSession> {
  const response = await fetch(`${API_URL}/api/v1/local/admin/session`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password })
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? "Sign-in failed.");
  }
  return response.json() as Promise<AdminSession>;
}

async function postJson<T>(path: string, body: unknown, session: AdminSession): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { method: "POST", headers: { ...adminHeaders(session), "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiRequestError(
      response.status,
      path,
      `POST ${path} failed (${response.status}): ${detail?.message ?? response.statusText}`
    );
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export async function revokeAdminSession(session: AdminSession): Promise<void> {
  await postJson<void>("/api/v1/local/admin/session/revoke", {}, session);
}

export async function changeOwnPassword(session: AdminSession, currentPassword: string, newPassword: string): Promise<void> {
  await patchJson<void>("/api/v1/local/admin/me/password", { currentPassword, newPassword }, session);
}

export async function listAdminUsers(session: AdminSession): Promise<AdminPrincipal[]> {
  const response = await readWithRetry("/api/v1/local/admin/users", session);
  if (!response.ok) throw new Error("Could not load administrator accounts.");
  return ((await response.json()) as { items: AdminPrincipal[] }).items;
}

export async function listAuditEntries(session: AdminSession): Promise<AuditEntry[]> {
  const path = "/api/v1/local/admin/audit-log";
  const response = await readWithRetry(path, session);
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiRequestError(
      response.status,
      path,
      `GET ${path} failed (${response.status}): ${detail?.message ?? response.statusText}`
    );
  }
  return ((await response.json()) as { items: AuditEntry[] }).items;
}

export async function createAdminUser(session: AdminSession, input: { username: string; displayName: string; role: ManagedAdminRole; temporaryPassword: string }): Promise<AdminPrincipal> {
  const response = await fetch(`${API_URL}/api/v1/local/admin/users`, { method: "POST", headers: { ...adminHeaders(session), "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? "Could not create the administrator.");
  }
  return ((await response.json()) as { user: AdminPrincipal }).user;
}

export async function updateAdminUser(session: AdminSession, userId: string, update: { displayName?: string; role?: ManagedAdminRole; isActive?: boolean }): Promise<AdminPrincipal> {
  const response = await patchJson<{ user: AdminPrincipal }>(`/api/v1/local/admin/users/${userId}`, update, session);
  return response.user;
}

export async function reviewCaseAction(session: AdminSession, reviewCaseId: string, action: ReviewAction, reason: string): Promise<ReviewCase> {
  const response = await postJson<{ item: ReviewCase }>(`/api/v1/local/review-cases/${reviewCaseId}/actions`, { action, reason }, session);
  return response.item;
}

function operationWarning(endpoint: string, error: unknown): OperationsWarning {
  return {
    endpoint,
    status: error instanceof ApiRequestError ? error.status : null,
    message: error instanceof Error ? error.message : `GET ${endpoint} could not be completed.`
  };
}

export async function loadOperationsData(session: AdminSession) {
  const fixtures = await getJson<Fixtures>("/api/v1/local/reference-data", session);
  const [eventsResult, statesResult] = await Promise.all([
    getJson<{ items: StoredEvent[] }>("/api/v1/local/events", session),
    getJson<{ items: Projection[] }>("/api/v1/containers/states", session)
  ]);
  const [reviewCasesResult, auditResult] = await Promise.allSettled([
    getJson<{ items: ReviewCase[] }>("/api/v1/local/review-cases", session),
    listAuditEntries(session)
  ]);
  const warnings: OperationsWarning[] = [];
  const reviewCases = reviewCasesResult.status === "fulfilled"
    ? reviewCasesResult.value.items
    : (warnings.push(operationWarning("/api/v1/local/review-cases", reviewCasesResult.reason)), []);
  const auditEntries = auditResult.status === "fulfilled"
    ? auditResult.value
    : (warnings.push(operationWarning("/api/v1/local/admin/audit-log", auditResult.reason)), []);
  const projectionById = new Map(
    statesResult.items.map((projection) => [projection.containerId, projection])
  );
  return {
    fixtures,
    events: eventsResult.items,
    reviewCases,
    auditEntries,
    warnings,
    projections: Object.fromEntries(
      fixtures.containers.map((container) => [
        container.containerId,
        projectionById.get(container.containerId) ?? null
      ])
    ) as Record<string, Projection | null>
  };
}
