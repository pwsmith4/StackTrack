export const API_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:3000";

/** The URL prefix Vite emitted for this deployment ("/" locally, "/StackTrack/testing/" on Pages). */
export const SITE_BASE_PATH = import.meta.env.BASE_URL ?? "/";

// The deployment workflow injects the commit SHA so a reviewer can verify
// which build is actually being served by GitHub Pages.  Keeping the fallback
// deterministic makes local development equally clear.
export const BUILD_ID = import.meta.env.VITE_BUILD_ID ?? "local";
export const BUILD_TIME = import.meta.env.VITE_BUILD_TIME ?? "";

export interface SiteBuildInfo {
  buildId: string;
  buildTime?: string;
  branch?: string;
  generatedAt?: string;
}

/**
 * Read the tiny deployment manifest with a unique query string. GitHub Pages
 * caches index.html for a short period, so the manifest gives an already-open
 * console a reliable way to notice that its hashed JavaScript is no longer
 * current. A missing manifest is normal during local development and older
 * deployments, so callers can safely treat null as "not available".
 */
export async function checkForNewBuild(): Promise<SiteBuildInfo | null> {
  if (BUILD_ID === "local") return null;
  const base = SITE_BASE_PATH.endsWith("/") ? SITE_BASE_PATH : `${SITE_BASE_PATH}/`;
  try {
    const response = await fetch(`${base}version.json?refresh=${Date.now()}`, {
      cache: "no-store",
      headers: { "cache-control": "no-cache" }
    });
    if (!response.ok) return null;
    const manifest = await response.json() as Partial<SiteBuildInfo>;
    if (typeof manifest.buildId !== "string" || manifest.buildId.trim().length < 7) return null;
    return {
      buildId: manifest.buildId,
      ...(typeof manifest.buildTime === "string" ? { buildTime: manifest.buildTime } : {}),
      ...(typeof manifest.branch === "string" ? { branch: manifest.branch } : {}),
      ...(typeof manifest.generatedAt === "string" ? { generatedAt: manifest.generatedAt } : {})
    };
  } catch {
    return null;
  }
}

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
  isActive?: boolean;
}

export type ManagedLocationType = Exclude<Location["type"], "in_transit">;

export interface LocationDependencyDevice {
  deviceId: string;
  label: string;
  isActive: boolean;
}

export interface LocationDependencyManager {
  userId: string;
  username: string;
  displayName: string;
  role: "location_manager" | "read_only_reviewer";
}

export interface LocationDependencySummary {
  location: Location;
  devices: LocationDependencyDevice[];
  managers: LocationDependencyManager[];
  currentContainerCount: number;
  loadCodeCount: number;
  observationCount: number;
}

export interface LocationRetireResult {
  location: Location;
  movedDeviceCount: number;
  replacementLocationId: string | null;
  unknownLocationId: string | null;
  dependencies: LocationDependencySummary;
}

export interface Device {
  deviceId: string;
  installationId: string;
  label: string;
  assignedLocationId: string;
  isActive: boolean;
  deactivatedAt: string | null;
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

export type AdminRole = "organization_owner" | "operations_administrator" | "location_manager" | "read_only_reviewer" | "support";
export type ManagedAdminRole = Exclude<AdminRole, "support">;
export interface AdminPrincipal {
  tenantId: string;
  userId: string;
  username: string;
  displayName: string;
  role: AdminRole;
  locationIds?: string[];
  supportExpiresAt: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  rolePreview?: AdminRolePreview;
}
export interface AdminRolePreview { sourceRole: AdminRole; previewRole: AdminRole; locationIds: string[]; expiresAt: string; }
export interface AdminSession { token: string; principal: AdminPrincipal; expiresAt: string; rolePreviewToken?: string; rolePreview?: AdminRolePreview; }
export interface AdminRolePreviewSession { previewToken: string; principal: AdminPrincipal; expiresAt: string; preview: AdminRolePreview; }
export interface AuditEntry { auditId: string; occurredAt: string; actorType: "user" | "device" | "system"; actorDisplayName: string; actorUsername?: string | null; action: string; targetType: string; targetId: string | null; targetLabel?: string | null; locationId?: string | null; locationName?: string | null; details: Record<string, unknown>; }
export interface AuditPage { items: AuditEntry[]; total: number; limit: number; offset: number; }
export interface AuditSearchFilters { search?: string; locationId?: string; deviceId?: string; selectedLocationIds?: string[]; selectedDeviceIds?: string[]; actorUserId?: string; actionPrefixes?: string[]; targetTypes?: string[]; actionPrefix?: string; targetType?: string; from?: string; to?: string; limit?: number; offset?: number; }
export type ReviewAction = "assigned" | "approved" | "rejected" | "resolved" | "reopened";
export interface ReviewCase { reviewCaseId: string; containerId: string; containerLabel: string; reasonCode: string; evidenceEventIds: string[]; openedAt: string; status: "opened" | ReviewAction; lastActionAt: string | null; lastActionReason: string | null; actionCount: number; }
export type CorrectionImpact = "routine" | "material";
export type CorrectionAction = "approved" | "rejected" | "reopened";
export interface ProposedCorrection { locationId?: string; loadState?: "unknown" | "empty" | "loaded"; }
export interface CorrectionRequest {
  correctionRequestId: string;
  containerId: string;
  containerLabel: string;
  requestedByUserId: string;
  requestedByDisplayName: string;
  impactLevel: CorrectionImpact;
  reason: string;
  proposedCorrection: ProposedCorrection;
  requestedAt: string;
  status: "pending" | CorrectionAction;
  latestActionAt: string | null;
  latestActionReason: string | null;
  latestActorDisplayName: string | null;
  actionCount: number;
}
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
  administrativeCorrection?: {
    correctionRequestId: string;
    approvedAt: string;
    approvedByDisplayName: string;
    reason: string;
  };
}

const headers = { "x-stacktrack-tenant-id": TENANT_ID };
const readRetryDelaysMs = [750, 2_000, 5_000];
const retryableReadStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

function adminHeaders(session?: AdminSession | null) {
  return session
    ? {
        authorization: `Bearer ${session.token}`,
        ...(session.rolePreviewToken ? { "x-stacktrack-role-preview": session.rolePreviewToken } : {})
      }
    : {};
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

export async function getLocationDependencies(
  session: AdminSession,
  locationId: string
): Promise<LocationDependencySummary> {
  return getJson<LocationDependencySummary>(
    `/api/v1/local/locations/${locationId}/dependencies`,
    session
  );
}

export async function createLocation(
  session: AdminSession,
  input: { name: string; type: ManagedLocationType }
): Promise<Location> {
  const response = await postJson<{ location: Location }>(
    "/api/v1/local/locations",
    input,
    session
  );
  return response.location;
}

export async function retireLocation(
  session: AdminSession,
  locationId: string,
  input: {
    replacementLocationId?: string;
    moveDevicesToUnknown?: boolean;
    confirmation: string;
  }
): Promise<LocationRetireResult> {
  const response = await postJson<{ result: LocationRetireResult }>(
    `/api/v1/local/locations/${locationId}/retire`,
    input,
    session
  );
  return response.result;
}

export async function signIn(username: string, password: string): Promise<AdminSession> {
  const response = await fetch(`${API_URL}/api/v1/local/admin/session`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ username, password })
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? "Sign-in failed.");
  }
  return response.json() as Promise<AdminSession>;
}

export async function startRolePreview(
  session: AdminSession,
  role: AdminRole,
  locationIds: string[] = []
): Promise<AdminRolePreviewSession> {
  const response = await fetch(`${API_URL}/api/v1/local/admin/role-preview`, {
    method: "POST",
    headers: { ...headers, ...adminHeaders(session), "content-type": "application/json", "cache-control": "no-cache" },
    body: JSON.stringify({ role, locationIds })
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiRequestError(response.status, "/api/v1/local/admin/role-preview", detail?.message ?? "The role preview could not be started.");
  }
  return response.json() as Promise<AdminRolePreviewSession>;
}

export async function requestAccessHelp(username: string, message: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/v1/local/admin/access-issues`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ username: username.trim() || undefined, message })
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? "The sign-in help request could not be sent.");
  }
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

export async function searchAuditEntries(session: AdminSession, filters: AuditSearchFilters = {}): Promise<AuditPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0)) params.set(key, String(value));
  }
  const path = `/api/v1/local/admin/audit-log${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await readWithRetry(path, session);
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiRequestError(
      response.status,
      path,
      `GET ${path} failed (${response.status}): ${detail?.message ?? response.statusText}`
    );
  }
  const result = await response.json() as AuditPage;
  return { items: result.items ?? [], total: Number(result.total ?? 0), limit: Number(result.limit ?? filters.limit ?? 100), offset: Number(result.offset ?? filters.offset ?? 0) };
}

export async function createAdminUser(session: AdminSession, input: { username: string; displayName: string; role: ManagedAdminRole; temporaryPassword: string; locationIds?: string[] }): Promise<AdminPrincipal> {
  const response = await fetch(`${API_URL}/api/v1/local/admin/users`, { method: "POST", headers: { ...adminHeaders(session), "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? "Could not create the administrator.");
  }
  return ((await response.json()) as { user: AdminPrincipal }).user;
}

export async function updateAdminUser(session: AdminSession, userId: string, update: { displayName?: string; role?: ManagedAdminRole; isActive?: boolean; locationIds?: string[] }): Promise<AdminPrincipal> {
  const response = await patchJson<{ user: AdminPrincipal }>(`/api/v1/local/admin/users/${userId}`, update, session);
  return response.user;
}

export async function removeAdminUser(session: AdminSession, userId: string, confirmation: string): Promise<{ userId: string; username: string; displayName: string; role: AdminRole }> {
  const response = await fetch(`${API_URL}/api/v1/local/admin/users/${userId}`, {
    method: "DELETE",
    headers: { ...adminHeaders(session), "content-type": "application/json" },
    body: JSON.stringify({ confirmation })
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? "Could not permanently remove the administrator.");
  }
  return ((await response.json()) as { removed: { userId: string; username: string; displayName: string; role: AdminRole } }).removed;
}

export async function resetAdminPassword(session: AdminSession, userId: string, temporaryPassword: string, reason = "Owner initiated password reset"): Promise<AdminPrincipal> {
  const response = await postJson<{ user: AdminPrincipal }>(
    `/api/v1/local/admin/users/${userId}/password-reset`,
    { temporaryPassword, reason },
    session
  );
  return response.user;
}

export async function reviewCaseAction(session: AdminSession, reviewCaseId: string, action: ReviewAction, reason: string): Promise<ReviewCase> {
  const response = await postJson<{ item: ReviewCase }>(`/api/v1/local/review-cases/${reviewCaseId}/actions`, { action, reason }, session);
  return response.item;
}

export async function createCorrectionRequest(
  session: AdminSession,
  input: {
    containerId: string;
    impactLevel: CorrectionImpact;
    reason: string;
    proposedCorrection: ProposedCorrection;
  }
): Promise<CorrectionRequest> {
  const response = await postJson<{ item: CorrectionRequest }>(
    "/api/v1/local/correction-requests",
    input,
    session
  );
  return response.item;
}

export async function correctionRequestAction(
  session: AdminSession,
  correctionRequestId: string,
  action: CorrectionAction,
  reason: string
): Promise<CorrectionRequest> {
  const response = await postJson<{ item: CorrectionRequest }>(
    `/api/v1/local/correction-requests/${correctionRequestId}/actions`,
    { action, reason },
    session
  );
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
  const [reviewCasesResult, correctionRequestsResult, auditResult] = await Promise.allSettled([
    getJson<{ items: ReviewCase[] }>("/api/v1/local/review-cases", session),
    getJson<{ items: CorrectionRequest[] }>("/api/v1/local/correction-requests", session),
    listAuditEntries(session)
  ]);
  const warnings: OperationsWarning[] = [];
  const reviewCases = reviewCasesResult.status === "fulfilled"
    ? reviewCasesResult.value.items
    : (warnings.push(operationWarning("/api/v1/local/review-cases", reviewCasesResult.reason)), []);
  const correctionRequests = correctionRequestsResult.status === "fulfilled"
    ? correctionRequestsResult.value.items
    : (warnings.push(operationWarning("/api/v1/local/correction-requests", correctionRequestsResult.reason)), []);
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
    correctionRequests,
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
