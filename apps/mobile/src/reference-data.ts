/** The browser/native local preview is the only place synthetic fixtures are safe. */
export function isLocalPreviewApi(apiUrl: string): boolean {
  return /^(?:https?:\/\/)?(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(apiUrl.trim());
}

/**
 * Cloud failures must never be hidden behind the demo dataset. A device may
 * use synthetic data only when no control-plane response was received and the
 * configured endpoint is explicitly local; a previously cached real dataset
 * is handled separately by the caller.
 */
export function shouldUseSyntheticReferenceData(input: {
  readonly apiUrl: string;
  readonly controlPlaneResponded: boolean;
  readonly hasCachedReferenceData: boolean;
}): boolean {
  return !input.controlPlaneResponded && !input.hasCachedReferenceData && isLocalPreviewApi(input.apiUrl);
}

/**
 * Cached reference data can support a real offline session, but it must not
 * survive an explicit authorization decision from the service. Keeping it
 * after a 401/403 could expose a retired assignment or container list on a
 * shared scanner.
 */
export function shouldClearCachedReferenceData(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * A temporary control-plane outage should not strand a scanner that already
 * has an explicit cached role. Client errors and authorization responses are
 * deliberately excluded: those represent a changed or invalid access
 * decision, not a safe offline condition.
 */
export function shouldRetainCachedDevicePermissions(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * A 503 can mean a short-lived service outage or a missing server migration.
 * The latter is an explicit configuration decision, not an offline condition;
 * cached permissions must not keep a scanner operating when the cloud cannot
 * verify its named role.
 */
export function isDevicePermissionConfigurationMissing(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const error = (input as { error?: unknown }).error;
  return error === "DevicePermissionConfigurationMissing";
}
