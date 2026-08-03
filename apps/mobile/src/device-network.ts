export interface DeviceRequestContext {
  readonly tenantId: string;
  readonly deviceId: string;
  readonly installationId: string;
}

/**
 * Headers shared by every mobile request. The installation ID is part of the
 * device authorization boundary; omitting it would make a queued replay look
 * like an unauthenticated scanner to the strict cloud API.
 */
export function deviceRequestHeaders(
  context: DeviceRequestContext,
  options: { readonly contentType?: boolean; readonly noCache?: boolean } = {}
): Record<string, string> {
  return {
    ...(options.contentType ? { "content-type": "application/json" } : {}),
    "x-stacktrack-tenant-id": context.tenantId,
    "x-stacktrack-device-id": context.deviceId,
    "x-stacktrack-device-installation-id": context.installationId,
    ...(options.noCache ? { "cache-control": "no-cache" } : {})
  };
}
