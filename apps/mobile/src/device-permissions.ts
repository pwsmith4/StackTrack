export const devicePermissionKeys = [
  "reference_data.read",
  "observation.create",
  "load_code.lookup",
  "telemetry.report"
] as const;

export type DevicePermissionKey = (typeof devicePermissionKeys)[number];
export type DevicePermissionMode = "enforced" | "compatibility" | "unavailable";

export interface DevicePermissionState {
  readonly mode: DevicePermissionMode;
  readonly permissionKeys: readonly DevicePermissionKey[];
  readonly resolvedAt?: string;
  /** Control-plane assignment metadata is separate from the container list. */
  readonly assignedLocationId?: string;
  readonly isActive?: boolean;
  readonly deviceLabel?: string;
  readonly message?: string;
}

const knownKeys = new Set<string>(devicePermissionKeys);

/** Parse a control-plane response without trusting arbitrary permission names. */
export function resolveDevicePermissions(input: unknown): DevicePermissionState {
  if (!input || typeof input !== "object") {
    return { mode: "unavailable", permissionKeys: [], message: "The scanner permission response was unreadable." };
  }
  const value = input as Record<string, unknown>;
  const permissionKeys = Array.isArray(value.permissionKeys)
    ? value.permissionKeys.filter((key): key is DevicePermissionKey => typeof key === "string" && knownKeys.has(key))
    : [];
  const resolvedAt = typeof value.resolvedAt === "string" ? value.resolvedAt : undefined;
  const assignedLocationId = typeof value.assignedLocationId === "string" ? value.assignedLocationId : undefined;
  const isActive = typeof value.isActive === "boolean" ? value.isActive : undefined;
  const deviceLabel = typeof value.deviceLabel === "string" ? value.deviceLabel : undefined;
  if (value.enforced === true) {
    return { mode: "enforced", permissionKeys, ...(resolvedAt ? { resolvedAt } : {}), ...(assignedLocationId ? { assignedLocationId } : {}), ...(isActive !== undefined ? { isActive } : {}), ...(deviceLabel ? { deviceLabel } : {}) };
  }
  return { mode: "compatibility", permissionKeys, ...(resolvedAt ? { resolvedAt } : {}), ...(assignedLocationId ? { assignedLocationId } : {}), ...(isActive !== undefined ? { isActive } : {}), ...(deviceLabel ? { deviceLabel } : {}) };
}

/** Compatibility mode is only returned by explicitly non-strict local pilots. */
export function canUseDevicePermission(
  state: DevicePermissionState,
  permissionKey: DevicePermissionKey
): boolean {
  return state.mode === "compatibility" || state.permissionKeys.includes(permissionKey);
}
