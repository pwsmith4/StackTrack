import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  InMemoryEventLedger,
  projectContainer,
  requestContextSchema,
  type EventLedger,
  type RequestContext,
  type StoredEvent
} from "@stacktrack/domain";
import { localFixtures, type LocalFixtures } from "./local-fixtures.js";
import type { DeviceAdministration, DeviceControlUpdate, DevicePermissionKey, DeviceTelemetryUpdate } from "./device-administration.js";
import type { AdminPrincipal, AdminUserUpdate, AuditFilters, NewAdminUser, PostgresAdminAccess } from "./admin-access.js";
import type { PostgresReviewAdministration, ReviewAction } from "./review-administration.js";
import type {
  CorrectionAction,
  CorrectionAdministration,
  NewCorrectionRequest
} from "./correction-administration.js";
import type {
  LocationAdministration,
  LocationRetireConflict,
  NewLocation,
  RetireLocationInput
} from "./location-administration.js";
import type {
  IdentityProvider,
  NotificationProvider,
  ReportingExporter
} from "./integration-ports.js";

export interface AppDependencies {
  readonly ledger?: EventLedger;
  readonly now?: () => Date;
  readonly localMode?: boolean;
  readonly referenceData?: (
    tenantId: string
  ) => LocalFixtures | null | Promise<LocalFixtures | null>;
  readonly deviceAdministration?: DeviceAdministration;
  readonly locationAdministration?: LocationAdministration;
  readonly adminAccess?: PostgresAdminAccess;
  readonly reviewAdministration?: PostgresReviewAdministration;
  readonly correctionAdministration?: CorrectionAdministration;
  /** Optional production identity adapter; the pilot uses adminAccess. */
  readonly identityProvider?: IdentityProvider;
  /** Optional delivery adapter for future approval/escalation notifications. */
  readonly notificationProvider?: NotificationProvider;
  /** Optional managed export adapter; browser CSV remains the pilot fallback. */
  readonly reportingExporter?: ReportingExporter;
  /**
   * Require the named device-role permission adapter for scanner traffic.
   * Lightweight in-memory test doubles may leave this false, but the cloud
   * server enables it so a missing permission configuration fails closed.
   */
  readonly strictDevicePermissions?: boolean;
}

interface ResettableLedger extends EventLedger {
  reset(): void | Promise<void>;
}

type AuditQuery = {
  search?: string;
  locationId?: string;
  deviceId?: string;
  selectedLocationIds?: string;
  selectedDeviceIds?: string;
  actorUserId?: string;
  actionPrefixes?: string;
  targetTypes?: string;
  actionPrefix?: string;
  targetType?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
};

function parseAuditDate(value: string | undefined, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "00:00:00.000" : "00:00:00.000"}Z`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function isResettable(ledger: EventLedger): ledger is ResettableLedger {
  return "reset" in ledger && typeof ledger.reset === "function";
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Keep a partially migrated cloud control plane fail-closed and diagnosable. */
function isMissingDevicePermissionSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42P01" || code === "42703";
}

function readContext(request: FastifyRequest): RequestContext | null {
  const parsed = requestContextSchema.safeParse({
    tenantId: firstHeader(request.headers["x-stacktrack-tenant-id"]),
    deviceId: firstHeader(request.headers["x-stacktrack-device-id"])
  });
  return parsed.success ? parsed.data : null;
}

function readTenantId(request: FastifyRequest): string | null {
  const tenantId = firstHeader(request.headers["x-stacktrack-tenant-id"]);
  const parsed = requestContextSchema.shape.tenantId.safeParse(tenantId);
  return parsed.success ? parsed.data : null;
}

function readBearerToken(request: FastifyRequest): string | null {
  const value = firstHeader(request.headers.authorization);
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length >= 32 ? token : null;
}

function publicEvent(event: StoredEvent) {
  const { canonicalPayload: _canonicalPayload, ...result } = event;
  return result;
}

function readRolePreviewToken(request: FastifyRequest): string | null {
  const value = firstHeader(request.headers["x-stacktrack-role-preview"]);
  return value && value.length >= 32 ? value : null;
}

function isLocationManager(principal: AdminPrincipal): boolean {
  return principal.role === "location_manager";
}

/**
 * A non-corporate account is scoped only when explicit site assignments exist.
 * This lets a read-only reviewer be either network-wide (legacy account) or
 * deliberately limited to a set of locations without changing the owner and
 * operations roles.
 */
function isScopedPrincipal(principal: AdminPrincipal): boolean {
  return isLocationManager(principal) || (principal.role === "read_only_reviewer" && (principal.locationIds?.length ?? 0) > 0);
}

function principalLocationIds(principal: AdminPrincipal): ReadonlySet<string> | null {
  return isScopedPrincipal(principal) ? new Set(principal.locationIds ?? []) : null;
}

function eventVisibleToPrincipal(
  event: StoredEvent,
  principal: AdminPrincipal,
  fixtures: LocalFixtures
): boolean {
  const scope = principalLocationIds(principal);
  if (!scope) return true;
  if (scope.size === 0) return false;
  if (scope.has(event.locationId)) return true;
  const device = fixtures.devices.find((item) => item.deviceId === event.deviceId);
  if (!device) return false;
  // A scanner can move after it records an observation. Resolve its assignment
  // at the observation time instead of using today's location, otherwise a
  // manager could see historical events from a site they never operated.
  const history = fixtures.deviceAssignments
    .filter((assignment) => assignment.deviceId === event.deviceId)
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  let locationId = history[0]?.previousLocationId ?? device.assignedLocationId;
  const eventAt = Date.parse(event.eventAt);
  for (const assignment of history) {
    if (Date.parse(assignment.occurredAt) > eventAt) break;
    locationId = assignment.assignedLocationId;
  }
  return scope.has(locationId);
}

function scopedFixtures(
  fixtures: LocalFixtures,
  principal: AdminPrincipal,
  events: readonly StoredEvent[]
): LocalFixtures {
  const scope = principalLocationIds(principal);
  if (!scope) return fixtures;
  const devices = fixtures.devices.filter((device) => scope.has(device.assignedLocationId));
  const deviceIds = new Set(devices.map((device) => device.deviceId));
  const visibleEvents = events.filter((event) => eventVisibleToPrincipal(event, principal, fixtures));
  const visibleContainerIds = new Set(visibleEvents.map((event) => event.containerId));
  return {
    ...fixtures,
    // Keep the system transit node visible so a local manager can understand a
    // handoff without learning the entire network's operating directory.
    locations: fixtures.locations.filter((location) => scope.has(location.locationId) || location.type === "in_transit"),
    devices,
    deviceAssignments: fixtures.deviceAssignments.filter((assignment) =>
      deviceIds.has(assignment.deviceId) &&
      (scope.has(assignment.assignedLocationId) || scope.has(assignment.previousLocationId))
    ),
    containers: fixtures.containers.filter((container) => visibleContainerIds.has(container.containerId))
  };
}

export async function createApp(dependencies: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const ledger = dependencies.ledger ?? new InMemoryEventLedger();
  const now = dependencies.now ?? (() => new Date());
  const localMode = dependencies.localMode ?? false;
  // The password bridge is pilot-only. Once a production IdentityProvider is
  // supplied, the same governed administrator routes are available to it, but
  // the local username/password session endpoints remain disabled.
  const adminRoutesEnabled = localMode || Boolean(dependencies.identityProvider);
  const browserOrigins = (process.env.STACKTRACK_ALLOWED_ORIGINS ?? [
    "https://pwsmith4.github.io",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8081",
    "http://localhost:8081",
    "http://127.0.0.1:8082",
    "http://localhost:8082"
  ].join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  // Authentication and administrative routes are deliberately bounded even in
  // the isolated pilot. Route-specific limits below are tighter where an
  // action can create access or repeatedly test a password.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip
  });
  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply,
    options: { allowPendingPasswordChange?: boolean; allowPreviewWrite?: boolean } = {}
  ): Promise<AdminPrincipal | null> => {
    if (!dependencies.adminAccess && !dependencies.identityProvider) {
      reply.code(503).send({ error: "AdminAccessUnavailable", message: "Administrative sign-in has not been provisioned." });
      return null;
    }
    const token = readBearerToken(request);
    let principal = token
      ? dependencies.identityProvider
        ? await dependencies.identityProvider.authenticateAccessToken(token)
        : dependencies.adminAccess
          ? await dependencies.adminAccess.authenticate(token)
          : null
      : null;
    if (!principal) {
      reply.code(401).send({ error: "AdminAuthenticationRequired", message: "Sign in is required for this administrative action." });
      return null;
    }
    const previewToken = readRolePreviewToken(request);
    if (previewToken) {
      if (!token || !dependencies.adminAccess?.resolveRolePreview) {
        reply.code(401).send({ error: "RolePreviewExpired", message: "This role preview is no longer available. Return to your normal view and start it again." });
        return null;
      }
      const previewPrincipal = await dependencies.adminAccess.resolveRolePreview(principal, token, previewToken);
      if (!previewPrincipal) {
        reply.code(401).send({ error: "RolePreviewExpired", message: "This role preview is no longer available. Return to your normal view and start it again." });
        return null;
      }
      principal = previewPrincipal;
      if (!options.allowPreviewWrite && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
        reply.code(403).send({ error: "RolePreviewReadOnly", message: "Role previews are read-only. Return to your normal view before making a change." });
        return null;
      }
    }
    if (principal.mustChangePassword && !options.allowPendingPasswordChange) {
      reply.code(409).send({
        error: "PasswordChangeRequired",
        message: "Change the temporary password before viewing or managing pilot operations."
      });
      return null;
    }
    return principal;
  };

  type PreparedScannerSubmission =
    | { ok: true; input: unknown }
    | { ok: false; statusCode: 401 | 403 | 503; error: string; message: string };

  const strictDevicePermissions = dependencies.strictDevicePermissions === true;

  // Device assignment is the server-side authority for scanner-originated
  // observations. Keep this normalization in one place so single scans and
  // batch uploads enforce exactly the same rules.
  const prepareScannerSubmission = async (
    context: RequestContext,
    input: unknown
  ): Promise<PreparedScannerSubmission> => {
    if (!dependencies.deviceAdministration || !input || typeof input !== "object") {
      return { ok: true, input };
    }

    const body = input as Record<string, unknown>;
    const installationId = typeof body.deviceInstallationId === "string"
      ? body.deviceInstallationId
      : undefined;
    if (!installationId) {
      if (strictDevicePermissions) {
        return {
          ok: false,
          statusCode: 401,
          error: "DeviceInstallationRequired",
          message: "An active scanner installation is required to record observations."
        };
      }
      return { ok: true, input };
    }

    if (!dependencies.deviceAdministration.hasPermission) {
      if (strictDevicePermissions) {
        return {
          ok: false,
          statusCode: 503,
          error: "DevicePermissionConfigurationMissing",
          message: "Named scanner permissions are not configured. Ask an administrator to review the device role."
        };
      }
    } else {
      const allowed = await dependencies.deviceAdministration.hasPermission(
        context.tenantId,
        context.deviceId,
        installationId,
        "observation.create"
      );
      if (!allowed) {
        return {
          ok: false,
          statusCode: 403,
          error: "DevicePermissionDenied",
          message: "This scanner is not permitted to record observations. Ask an administrator to review its device role."
        };
      }
    }

    const scannerEnabled = await dependencies.deviceAdministration.isScannerEnabled(
      context.tenantId,
      context.deviceId,
      installationId
    );
    if (!scannerEnabled) {
      return {
        ok: false,
        statusCode: 403,
        error: "ScannerDisabled",
        message: "This scanner is disabled or no longer assigned to an active installation."
      };
    }

    if (!dependencies.deviceAdministration.assignedLocationId) {
      return { ok: true, input };
    }

    const assignedLocationId = await dependencies.deviceAdministration.assignedLocationId(
      context.tenantId,
      context.deviceId,
      installationId
    );
    if (!assignedLocationId) {
      return {
        ok: false,
        statusCode: 403,
        error: "ScannerAssignmentUnavailable",
        message: "This scanner has no active operating-location assignment."
      };
    }

    // A departure records only the location left; the receiving site is not
    // known until a later arrival scan. The server supplies the departure
    // origin from the device assignment and rejects spoofed origins.
    const payload = body.payload && typeof body.payload === "object"
      ? { ...(body.payload as Record<string, unknown>) }
      : {};
    if (body.eventType === "batch_out") {
      if (payload.sourceLocationId !== undefined && payload.sourceLocationId !== assignedLocationId) {
        return {
          ok: false,
          statusCode: 403,
          error: "ScannerLocationMismatch",
          message: "A departure must use the scanner's assigned operating location as its origin."
        };
      }
      payload.sourceLocationId = assignedLocationId;
    } else if (body.locationId !== assignedLocationId) {
      return {
        ok: false,
        statusCode: 403,
        error: "ScannerLocationMismatch",
        message: "This scanner can only record an observation at its assigned operating location."
      };
    }

    return { ok: true, input: { ...body, payload } };
  };

  app.addHook("onSend", async (request, reply, payload) => {
    if (adminRoutesEnabled) {
      const origin = firstHeader(request.headers.origin);
      if (origin && browserOrigins.includes(origin)) {
        reply.header("access-control-allow-origin", origin);
        reply.header("vary", "Origin");
        reply.header(
          "access-control-allow-headers",
          "authorization,content-type,cache-control,x-stacktrack-tenant-id,x-stacktrack-device-id,x-stacktrack-device-installation-id,x-stacktrack-role-preview"
        );
        reply.header("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
      }
    }
    return payload;
  });

  if (adminRoutesEnabled) {
    // Password recovery is intentionally available only to the isolated pilot
    // bridge. Production identity providers own sign-in, MFA, and recovery.
    if (localMode) {
      app.post<{ Body: { username?: string; password?: string } }>("/api/v1/local/admin/session", {
        config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
      }, async (request, reply) => {
        if (!dependencies.adminAccess || typeof request.body?.username !== "string" || typeof request.body?.password !== "string") {
          return reply.code(400).send({ error: "InvalidSignIn" });
        }
        const session = await dependencies.adminAccess.signIn(request.body.username, request.body.password);
        if (!session) return reply.code(401).send({ error: "InvalidCredentials", message: "The username or password is not valid." });
        return reply.send(session);
      });

      app.post<{ Body: { username?: unknown; message?: unknown } }>("/api/v1/local/admin/access-issues", {
        config: { rateLimit: { max: 3, timeWindow: "15 minutes" } }
      }, async (request, reply) => {
        const body = request.body ?? {};
        if (!dependencies.adminAccess) {
          return reply.code(503).send({ error: "AdminAccessUnavailable", message: "Sign-in help is not available right now." });
        }
        if ((body.username !== undefined && typeof body.username !== "string") ||
          typeof body.message !== "string") {
          return reply.code(400).send({ error: "InvalidAccessHelpRequest", message: "Add a short description of the sign-in problem." });
        }
        try {
          const result = await dependencies.adminAccess.requestAccessHelp(
            typeof body.username === "string" ? body.username : undefined,
            body.message
          );
          return reply.code(202).send({ accepted: true, requestId: result.requestId });
        } catch (error) {
          return reply.code(400).send({ error: "AccessHelpRequestRejected", message: error instanceof Error ? error.message : "The request could not be recorded." });
        }
      });
    }

    app.post<{ Body: { role?: unknown; locationIds?: unknown } }>("/api/v1/local/admin/role-preview", {
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } }
    }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      const sessionToken = readBearerToken(request);
      if (!principal || !sessionToken) return;
      if (principal.rolePreview) {
        return reply.code(403).send({ error: "RolePreviewAlreadyActive", message: "Return to your normal view before starting another role preview." });
      }
      if (!dependencies.adminAccess) {
        return reply.code(503).send({ error: "AdminAccessUnavailable", message: "Role preview is not available right now." });
      }
      const role = request.body?.role;
      const locationIds = request.body?.locationIds;
      if (typeof role !== "string" || (locationIds !== undefined && (!Array.isArray(locationIds) || locationIds.some((value) => typeof value !== "string")))) {
        return reply.code(400).send({ error: "InvalidRolePreview", message: "Choose a lower administrator role and valid locations." });
      }
      try {
        const preview = await dependencies.adminAccess.startRolePreview(
          principal,
          sessionToken,
          role,
          Array.isArray(locationIds) ? locationIds : undefined
        );
        return reply.code(201).send(preview);
      } catch (error) {
        return reply.code(400).send({ error: "RolePreviewRejected", message: error instanceof Error ? error.message : "The role preview could not be started." });
      }
    });

    app.get("/api/v1/local/admin/users", {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
    }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (principal.role !== "organization_owner") return reply.code(403).send({ error: "InsufficientRole" });
      return reply.send({ items: await dependencies.adminAccess!.listUsers() });
    });

    app.get<{ Querystring: AuditQuery }>("/api/v1/local/admin/audit-log", {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
    }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      const query = request.query;
      const uuidFields = ["locationId", "deviceId", "actorUserId"] as const;
      for (const field of uuidFields) {
        const value = query[field];
        if (value !== undefined && !requestContextSchema.shape.deviceId.safeParse(value).success) {
          return reply.code(400).send({ error: "InvalidAuditFilter", message: `${field} must be a UUID.` });
        }
      }
      const validUuidList = (value: string | undefined) => value === undefined || value === "" || (value.split(",").length <= 100 && value.split(",").every((item) => requestContextSchema.shape.deviceId.safeParse(item).success));
      if (!validUuidList(query.selectedLocationIds) || !validUuidList(query.selectedDeviceIds)) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Selected locations and scanners must be valid UUIDs." });
      }
      if (query.search !== undefined && query.search.length > 120) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Search text is limited to 120 characters." });
      }
      if (query.actionPrefix !== undefined && !/^[a-z0-9_.-]{1,64}$/i.test(query.actionPrefix)) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Action group is invalid." });
      }
      if (query.targetType !== undefined && !/^[a-z0-9_.-]{1,64}$/i.test(query.targetType)) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Target type is invalid." });
      }
      if (query.actionPrefixes !== undefined && !/^[a-z0-9_.-]{1,64}(,[a-z0-9_.-]{1,64})*$/i.test(query.actionPrefixes)) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Action groups are invalid." });
      }
      if (query.targetTypes !== undefined && !/^[a-z0-9_.-]{1,64}(,[a-z0-9_.-]{1,64})*$/i.test(query.targetTypes)) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Action subjects are invalid." });
      }
      const from = parseAuditDate(query.from);
      const to = parseAuditDate(query.to, true);
      if ((query.from && !from) || (query.to && !to)) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Dates must be valid ISO dates." });
      }
      const parseInteger = (value: string | undefined, fallback: number): number | undefined => {
        if (value === undefined || value === "") return fallback;
        if (!/^\d+$/.test(value)) return undefined;
        return Number(value);
      };
      const limit = parseInteger(query.limit, 100);
      const offset = parseInteger(query.offset, 0);
      if (limit === undefined || offset === undefined || limit < 1 || limit > 250 || offset < 0) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Limit must be 1-250 and offset must be non-negative." });
      }
      const filters: AuditFilters = {
        limit,
        offset,
        ...(query.search?.trim() ? { search: query.search.trim() } : {}),
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
        ...(query.selectedLocationIds?.trim() ? { selectedLocationIds: query.selectedLocationIds.split(",") } : {}),
        ...(query.selectedDeviceIds?.trim() ? { selectedDeviceIds: query.selectedDeviceIds.split(",") } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.actionPrefixes?.trim() ? { actionPrefixes: query.actionPrefixes.split(",") } : {}),
        ...(query.targetTypes?.trim() ? { targetTypes: query.targetTypes.split(",") } : {}),
        ...(query.actionPrefix?.trim() ? { actionPrefix: query.actionPrefix.trim() } : {}),
        ...(query.targetType?.trim() ? { targetType: query.targetType.trim() } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {})
      };
      const scopedFilters = isScopedPrincipal(principal)
        ? { ...filters, locationIds: [...(principalLocationIds(principal) ?? [])] }
        : filters;
      return reply.send(await dependencies.adminAccess!.searchAuditEntries(scopedFilters));
    });

    app.post<{ Body: NewAdminUser }>("/api/v1/local/admin/users", {
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } }
    }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (principal.role !== "organization_owner") return reply.code(403).send({ error: "InsufficientRole", message: "Only Organization Owners can add administrators." });
      const input = request.body;
      if (!input || typeof input.username !== "string" || typeof input.displayName !== "string" || typeof input.temporaryPassword !== "string" || !["organization_owner", "operations_administrator", "location_manager", "read_only_reviewer"].includes(input.role) || (input.locationIds !== undefined && (!Array.isArray(input.locationIds) || input.locationIds.some((value) => typeof value !== "string")))) {
        return reply.code(400).send({ error: "InvalidAdminUser" });
      }
      try {
        return reply.code(201).send({ user: await dependencies.adminAccess!.createUser(principal, input) });
      } catch (error) {
        return reply.code(400).send({ error: "AdminUserRejected", message: error instanceof Error ? error.message : "The user could not be created." });
      }
    });

    // Password sessions, resets, and temporary-password changes belong to the
    // pilot bridge. Entra/MFA-backed production identity owns these actions.
    if (localMode) {
      app.post("/api/v1/local/admin/session/revoke", {
        config: { rateLimit: { max: 30, timeWindow: "15 minutes" } }
      }, async (request, reply) => {
        const principal = await requireAdmin(request, reply, { allowPendingPasswordChange: true, allowPreviewWrite: true });
        const token = readBearerToken(request);
        if (!principal || !token) return;
        await dependencies.adminAccess!.revokeSession(principal, token);
        return reply.code(204).send();
      });

      app.patch<{ Body: { currentPassword?: string; newPassword?: string } }>("/api/v1/local/admin/me/password", {
        config: { rateLimit: { max: 10, timeWindow: "15 minutes" } }
      }, async (request, reply) => {
        const principal = await requireAdmin(request, reply, { allowPendingPasswordChange: true });
        const token = readBearerToken(request);
        const body = request.body;
        if (!principal || !token) return;
        if (typeof body?.currentPassword !== "string" || typeof body.newPassword !== "string") {
          return reply.code(400).send({ error: "InvalidPasswordChange" });
        }
        try {
          await dependencies.adminAccess!.changePassword(principal, token, body.currentPassword, body.newPassword);
          return reply.code(204).send();
        } catch (error) {
          return reply.code(400).send({ error: "PasswordChangeRejected", message: error instanceof Error ? error.message : "Password could not be changed." });
        }
      });
    }

    app.patch<{ Params: { userId: string }; Body: AdminUserUpdate }>("/api/v1/local/admin/users/:userId", {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
    }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (principal.role !== "organization_owner") return reply.code(403).send({ error: "InsufficientRole", message: "Only Organization Owners can manage administrator accounts." });
      const update = request.body;
      if (!update || (update.displayName !== undefined && typeof update.displayName !== "string") || (update.role !== undefined && !["organization_owner", "operations_administrator", "location_manager", "read_only_reviewer"].includes(update.role)) || (update.isActive !== undefined && typeof update.isActive !== "boolean") || (update.locationIds !== undefined && (!Array.isArray(update.locationIds) || update.locationIds.some((value) => typeof value !== "string")))) {
        return reply.code(400).send({ error: "InvalidAdminUserUpdate" });
      }
      try {
        return reply.send({ user: await dependencies.adminAccess!.updateUser(principal, request.params.userId, update) });
      } catch (error) {
        return reply.code(400).send({ error: "AdminUserUpdateRejected", message: error instanceof Error ? error.message : "Administrator account could not be updated." });
      }
    });

    app.delete<{ Params: { userId: string }; Body: { confirmation?: string } }>("/api/v1/local/admin/users/:userId", {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } }
    }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (principal.role !== "organization_owner") {
        return reply.code(403).send({ error: "InsufficientRole", message: "Only Organization Owners can permanently remove administrator accounts." });
      }
      const confirmation = request.body?.confirmation;
      if (typeof confirmation !== "string" || confirmation.trim().length < 3 || confirmation.length > 64) {
        return reply.code(400).send({ error: "RemovalConfirmationRequired", message: "Type the administrator username exactly to confirm permanent removal." });
      }
      try {
        const removed = await dependencies.adminAccess!.removeUser(principal, request.params.userId, confirmation);
        return reply.send({ removed });
      } catch (error) {
        return reply.code(400).send({ error: "AdminUserRemovalRejected", message: error instanceof Error ? error.message : "Administrator account could not be removed." });
      }
    });

    if (localMode) {
      app.post<{ Params: { userId: string }; Body: { temporaryPassword?: string; reason?: string } }>(
        "/api/v1/local/admin/users/:userId/password-reset",
        { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
        async (request, reply) => {
          const principal = await requireAdmin(request, reply);
          if (!principal) return;
          if (principal.role !== "organization_owner") {
            return reply.code(403).send({ error: "InsufficientRole", message: "Only Organization Owners can reset administrator passwords." });
          }
          const temporaryPassword = request.body?.temporaryPassword;
          const reason = request.body?.reason;
          if (typeof temporaryPassword !== "string" || temporaryPassword.length < 12 || temporaryPassword.length > 256 || (reason !== undefined && (typeof reason !== "string" || reason.trim().length < 8 || reason.trim().length > 500))) {
            return reply.code(400).send({ error: "InvalidTemporaryPassword", message: "Temporary password must contain 12-256 characters." });
          }
          try {
            const user = reason === undefined
              ? await dependencies.adminAccess!.resetUserPassword(principal, request.params.userId, temporaryPassword)
              : await dependencies.adminAccess!.resetUserPassword(principal, request.params.userId, temporaryPassword, reason);
            return reply.send({ user });
          } catch (error) {
            return reply.code(400).send({ error: "PasswordResetRejected", message: error instanceof Error ? error.message : "The administrator password could not be reset." });
          }
        }
      );
    }

    app.get("/api/v1/local/review-cases", {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
    }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (!dependencies.reviewAdministration) return reply.code(501).send({ error: "ReviewAdministrationUnavailable" });
      const items = await dependencies.reviewAdministration.listCases(principal.tenantId);
      if (!isScopedPrincipal(principal)) return reply.send({ items });
      const fixtures = (dependencies.referenceData
        ? await dependencies.referenceData(principal.tenantId)
        : principal.tenantId === localFixtures.tenant.tenantId ? localFixtures : null) ?? localFixtures;
      const visibleEventIds = new Set(
        (await ledger.eventsForTenant(principal.tenantId))
          .filter((event) => eventVisibleToPrincipal(event, principal, fixtures))
          .map((event) => event.eventId)
      );
      return reply.send({ items: items.filter((item) => item.evidenceEventIds.some((eventId) => visibleEventIds.has(eventId))) });
    });

    app.post<{ Params: { reviewCaseId: string }; Body: { action?: ReviewAction; reason?: string } }>("/api/v1/local/review-cases/:reviewCaseId/actions", {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
    }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (!dependencies.reviewAdministration) return reply.code(501).send({ error: "ReviewAdministrationUnavailable" });
      if (isScopedPrincipal(principal)) {
        return reply.code(403).send({ error: "InsufficientRole", message: "Location-scoped accounts can request a correction but cannot change review decisions." });
      }
      const body = request.body;
      if (!body || !["assigned", "approved", "rejected", "resolved", "reopened"].includes(body.action ?? "") || typeof body.reason !== "string") return reply.code(400).send({ error: "InvalidReviewAction" });
      try {
        return reply.send({ item: await dependencies.reviewAdministration.takeAction(principal.tenantId, principal, request.params.reviewCaseId, body.action!, body.reason) });
      } catch (error) {
        return reply.code(400).send({ error: "ReviewActionRejected", message: error instanceof Error ? error.message : "Review action could not be recorded." });
      }
    });

    app.get("/api/v1/local/correction-requests", {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
    }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (!dependencies.correctionAdministration) {
        return reply.code(501).send({ error: "CorrectionAdministrationUnavailable" });
      }
      const items = await dependencies.correctionAdministration.listRequests(principal.tenantId);
      if (!isScopedPrincipal(principal)) return reply.send({ items });
      const fixtures = (dependencies.referenceData
        ? await dependencies.referenceData(principal.tenantId)
        : principal.tenantId === localFixtures.tenant.tenantId ? localFixtures : null) ?? localFixtures;
      const visibleContainerIds = new Set(
        (await ledger.eventsForTenant(principal.tenantId))
          .filter((event) => eventVisibleToPrincipal(event, principal, fixtures))
          .map((event) => event.containerId)
      );
      const scope = principalLocationIds(principal)!;
      return reply.send({
        items: items.filter((item) =>
          visibleContainerIds.has(item.containerId) ||
          (typeof item.proposedCorrection.locationId === "string" && scope.has(item.proposedCorrection.locationId))
        )
      });
    });

    app.post<{ Body: NewCorrectionRequest }>(
      "/api/v1/local/correction-requests",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const principal = await requireAdmin(request, reply);
        if (!principal) return;
        if (!dependencies.correctionAdministration) {
          return reply.code(501).send({ error: "CorrectionAdministrationUnavailable" });
        }
        const input = request.body;
        if (
          !input ||
          typeof input.containerId !== "string" ||
          !["routine", "material"].includes(input.impactLevel) ||
          typeof input.reason !== "string" ||
          !input.proposedCorrection ||
          typeof input.proposedCorrection !== "object"
        ) {
          return reply.code(400).send({ error: "InvalidCorrectionRequest" });
        }
        try {
          return reply.code(201).send({
            item: await dependencies.correctionAdministration.createRequest(
              principal.tenantId,
              principal,
              input
            )
          });
        } catch (error) {
          return reply.code(400).send({
            error: "CorrectionRequestRejected",
            message:
              error instanceof Error ? error.message : "Correction request could not be recorded."
          });
        }
      }
    );

    app.post<{
      Params: { correctionRequestId: string };
      Body: { action?: CorrectionAction; reason?: string };
    }>(
      "/api/v1/local/correction-requests/:correctionRequestId/actions",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const principal = await requireAdmin(request, reply);
        if (!principal) return;
        if (!dependencies.correctionAdministration) {
          return reply.code(501).send({ error: "CorrectionAdministrationUnavailable" });
        }
        const body = request.body;
        if (
          !body ||
          !["approved", "rejected", "reopened"].includes(body.action ?? "") ||
          typeof body.reason !== "string"
        ) {
          return reply.code(400).send({ error: "InvalidCorrectionAction" });
        }
        try {
          return reply.send({
            item: await dependencies.correctionAdministration.takeAction(
              principal.tenantId,
              principal,
              request.params.correctionRequestId,
              body.action!,
              body.reason
            )
          });
        } catch (error) {
          return reply.code(400).send({
            error: "CorrectionActionRejected",
            message:
              error instanceof Error ? error.message : "Correction decision could not be recorded."
          });
        }
      }
    );

    app.options("/*", async (_request, reply) => reply.code(204).send());
  }

  // Keep the container root useful when an operator opens the Azure URL in a
  // browser.  It deliberately exposes no tenant data or configuration; the
  // authenticated API remains behind the routes below and `/health` stays the
  // machine-readable probe used by platform checks.
  app.get("/", async () => ({
    service: "StackTrack API",
    status: "ok",
    health: "/health"
  }));

  app.get("/health", async () => ({ status: "ok" }));

  const readInstallationId = (request: FastifyRequest): string | null => {
    const value = firstHeader(request.headers["x-stacktrack-device-installation-id"]);
    return value && requestContextSchema.shape.deviceId.safeParse(value).success ? value : null;
  };

  const requireDevicePermission = async (
    request: FastifyRequest,
    reply: FastifyReply,
    context: RequestContext,
    permissionKey: DevicePermissionKey
  ): Promise<boolean> => {
    if (!dependencies.deviceAdministration?.hasPermission) {
      if (strictDevicePermissions) {
        reply.code(503).send({
          error: "DevicePermissionConfigurationMissing",
          message: "Named scanner permissions are not configured. Ask an administrator to review the device role."
        });
        return false;
      }
      return true;
    }
    const installationId = readInstallationId(request);
    if (!installationId) {
      reply.code(401).send({ error: "DeviceInstallationRequired", message: "An active scanner installation is required for this action." });
      return false;
    }
    let allowed: boolean;
    try {
      allowed = await dependencies.deviceAdministration.hasPermission(
        context.tenantId,
        context.deviceId,
        installationId,
        permissionKey
      );
    } catch (error) {
      if (isMissingDevicePermissionSchema(error)) {
        reply.code(503).send({
          error: "DevicePermissionConfigurationMissing",
          message: "Named scanner permissions are not configured. Ask an administrator to finish the device-role setup."
        });
        return false;
      }
      throw error;
    }
    if (!allowed) {
      reply.code(403).send({ error: "DevicePermissionDenied", message: `This scanner is not permitted to use ${permissionKey}. Ask an administrator to review its device role.` });
      return false;
    }
    return true;
  };

  app.get<{ Params: { containerId: string } }>(
    "/api/v1/mobile/load-code/:containerId",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const context = readContext(request);
      if (!context) return reply.code(401).send({ error: "Unauthorized" });
      if (!requestContextSchema.shape.deviceId.safeParse(context.deviceId).success) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const containerId = request.params.containerId;
      if (!requestContextSchema.shape.deviceId.safeParse(containerId).success) {
        return reply.code(400).send({ error: "InvalidContainerId" });
      }
      if (!(await requireDevicePermission(request, reply, context, "load_code.lookup"))) return;

      const events = await ledger.eventsForContainer(context.tenantId, containerId);
      const projection = projectContainer(events);
      const synchronizedAt = now().toISOString();
      if (!projection?.activeLoadCodeId) {
        return reply.send({ found: false, synchronizedAt });
      }

      const loadEvent = events.find(
        (event) =>
          event.eventType === "load_assigned" &&
          event.loadCodeId === projection.activeLoadCodeId
      );
      if (!loadEvent) return reply.send({ found: false, synchronizedAt });

      return reply.send({
        found: true,
        synchronizedAt,
        loadCode: {
          loadCodeId: loadEvent.loadCodeId,
          displayLoadCode:
            typeof loadEvent.payload.displayLoadCode === "string"
              ? loadEvent.payload.displayLoadCode
              : loadEvent.loadCodeId,
          goodsType:
            typeof loadEvent.payload.goodsType === "string"
              ? loadEvent.payload.goodsType
              : "Other",
          secondaryValue:
            typeof loadEvent.payload.secondaryValue === "string"
              ? loadEvent.payload.secondaryValue
              : "Not specified",
          generatedAt: loadEvent.effectiveAt,
          generatingLocationId: loadEvent.locationId
        }
      });
    }
  );

  // Mobile control-plane routes are available in both the synthetic pilot and
  // the cloud API. Keeping this route outside the local-admin block prevents
  // a production mobile build from silently receiving a 404 after login.
  app.get("/api/v1/mobile/reference-data", async (request, reply) => {
    const context = readContext(request);
    if (!context) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await requireDevicePermission(request, reply, context, "reference_data.read"))) return;
    const fixtures = dependencies.referenceData
      ? await dependencies.referenceData(context.tenantId)
      : context.tenantId === localFixtures.tenant.tenantId ? localFixtures : null;
    if (!fixtures) return reply.code(404).send({ error: "NotFound" });
    return reply.send(fixtures);
  });

  app.get("/api/v1/mobile/permissions", async (request, reply) => {
    const context = readContext(request);
    if (!context) return reply.code(401).send({ error: "Unauthorized" });
    const installationId = readInstallationId(request);
    if (!installationId) {
      return reply.code(401).send({
        error: "DeviceInstallationRequired",
        message: "An active scanner installation is required to resolve device permissions."
      });
    }
    const administration = dependencies.deviceAdministration;
    if (!administration?.permissionKeys) {
      if (strictDevicePermissions) {
        return reply.code(503).send({
          error: "DevicePermissionConfigurationMissing",
          message: "Named scanner permissions are not configured. Ask an administrator to review the device role."
        });
      }
      // Legacy/local test doubles do not have named roles yet. The conservative
      // response is an empty set rather than an invented grant.
      const assignedLocationId = administration?.assignedLocationId
        ? await administration.assignedLocationId(context.tenantId, context.deviceId, installationId)
        : null;
      const isActive = administration?.isScannerEnabled
        ? await administration.isScannerEnabled(context.tenantId, context.deviceId, installationId)
        : true;
      return reply.send({ permissionKeys: [], resolvedAt: now().toISOString(), enforced: false, ...(assignedLocationId ? { assignedLocationId } : {}), isActive });
    }
    let permissionKeys: readonly DevicePermissionKey[];
    let assignedLocationId: string | null = null;
    let isActive = true;
    try {
      permissionKeys = await administration.permissionKeys(
        context.tenantId,
        context.deviceId,
        installationId
      );
      assignedLocationId = administration.assignedLocationId
        ? await administration.assignedLocationId(context.tenantId, context.deviceId, installationId)
        : null;
      isActive = administration.isScannerEnabled
        ? await administration.isScannerEnabled(context.tenantId, context.deviceId, installationId)
        : true;
    } catch (error) {
      if (isMissingDevicePermissionSchema(error)) {
        return reply.code(503).send({
          error: "DevicePermissionConfigurationMissing",
          message: "Named scanner permissions are not configured. Ask an administrator to finish the device-role setup."
        });
      }
      throw error;
    }
    return reply.send({
      permissionKeys,
      resolvedAt: now().toISOString(),
      enforced: strictDevicePermissions,
      ...(assignedLocationId ? { assignedLocationId } : {}),
      isActive
    });
  });

  const handleMobileTelemetry = async (
    request: FastifyRequest<{ Params: { deviceId?: string }; Body: DeviceTelemetryUpdate }>,
    reply: FastifyReply
  ) => {
    const context = readContext(request);
    if (!context) return reply.code(401).send({ error: "Unauthorized" });
    // The cloud mobile endpoint derives the device from the authenticated
    // request context; the local compatibility alias also includes it in the
    // path.  Validate both forms when the path parameter is present.
    const pathDeviceId = request.params?.deviceId;
    if (pathDeviceId && context.deviceId !== pathDeviceId) {
      return reply.code(403).send({
        error: "DeviceIdentityMismatch",
        message: "A scanner can only report telemetry for its own device identifier."
      });
    }
    const administration = dependencies.deviceAdministration;
    if (!administration) return reply.code(501).send({ error: "DeviceAdministrationUnavailable" });
    const update = request.body;
    if (
      !update ||
      typeof update.installationId !== "string" ||
      !requestContextSchema.shape.deviceId.safeParse(update.installationId).success ||
      typeof update.appVersion !== "string" ||
      update.appVersion.trim().length < 1 ||
      update.appVersion.trim().length > 32 ||
      !Number.isInteger(update.pendingOfflineScanCount) ||
      update.pendingOfflineScanCount < 0 ||
      update.pendingOfflineScanCount > 100_000
    ) {
      return reply.code(400).send({ error: "InvalidDeviceTelemetry" });
    }
    if (!administration.hasPermission) {
      if (strictDevicePermissions) {
        return reply.code(503).send({
          error: "DevicePermissionConfigurationMissing",
          message: "Named scanner permissions are not configured. Ask an administrator to review the device role."
        });
      }
    } else {
      const permitted = await administration.hasPermission(
        context.tenantId,
        context.deviceId,
        update.installationId,
        "telemetry.report"
      );
      if (!permitted) {
        return reply.code(403).send({
          error: "DevicePermissionDenied",
          message: "This scanner is not permitted to report telemetry. Ask an administrator to review its device role."
        });
      }
    }
    const device = await administration.reportTelemetry(
      context.tenantId,
      context.deviceId,
      update
    );
    if (!device) return reply.code(404).send({ error: "NotFound" });
    return reply.send({ device });
  };

  app.patch<{ Params: { deviceId: string }; Body: DeviceTelemetryUpdate }>(
    "/api/v1/mobile/telemetry",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    handleMobileTelemetry
  );

  app.get("/api/v1/time", async (request, reply) => {
    const context = readContext(request);
    if (!context) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    return reply.send({ serverAt: now().toISOString() });
  });

  app.post<{ Body: { items?: unknown[] } }>(
    "/api/v1/events/batch",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const context = readContext(request);
      if (!context) {
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Development authentication requires valid tenant and device UUID headers."
        });
      }

      const items = request.body?.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
        return reply.code(400).send({
          error: "InvalidBatch",
          message: "Batch uploads must contain between 1 and 100 observations."
        });
      }

      const results = [] as Array<Record<string, unknown>>;
      for (const [index, item] of items.entries()) {
        const eventId = item && typeof item === "object" && typeof (item as Record<string, unknown>).eventId === "string"
          ? (item as Record<string, unknown>).eventId
          : undefined;
        const prepared = await prepareScannerSubmission(context, item);
        if (!prepared.ok) {
          results.push({ index, ...(eventId ? { eventId } : {}), accepted: false, status: "rejected", error: prepared.error, message: prepared.message });
          continue;
        }
        try {
          const result = await ledger.submit(prepared.input, context, now());
          results.push({
            index,
            ...(eventId ? { eventId } : {}),
            accepted: result.accepted,
            status: result.status,
            warnings: result.warnings,
            ...(result.errorCode ? { error: result.errorCode } : {}),
            ...(result.message ? { message: result.message } : {}),
            ...(result.event ? { event: publicEvent(result.event) } : {})
          });
        } catch (error) {
          // A single item must never abort the entire 1–N upload. A database
          // constraint, stale reference, or adapter failure is reported with
          // the item's index so the device can keep the other observations
          // and an administrator can investigate the failed one.
          results.push({
            index,
            ...(eventId ? { eventId } : {}),
            accepted: false,
            status: "retryable",
            retryable: true,
            error: "ItemProcessingFailed",
            message: error instanceof Error ? error.message : "This observation could not be recorded."
          });
        }
      }

      const acceptedCount = results.filter((result) => result.accepted === true).length;
      const status = acceptedCount === results.length
        ? "accepted"
        : acceptedCount === 0
          ? "rejected"
          : "partial";
      return reply.code(200).send({ accepted: acceptedCount > 0, status, acceptedCount, rejectedCount: results.length - acceptedCount, results });
    }
  );

  app.post("/api/v1/events", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const context = readContext(request);
    if (!context) {
      return reply.code(401).send({
        error: "Unauthorized",
        message:
          "Development authentication requires valid tenant and device UUID headers."
      });
    }

    const prepared = await prepareScannerSubmission(context, request.body);
    if (!prepared.ok) return reply.code(prepared.statusCode).send({ error: prepared.error, message: prepared.message });

    const result = await ledger.submit(prepared.input, context, now());
    if (!result.accepted) {
      const statusCode =
        result.errorCode === "IdempotencyKeyMismatch" ? 422 : 400;
      return reply.code(statusCode).send({
        error: result.errorCode,
        message: result.message
      });
    }

    return reply.code(result.status === "duplicate" ? 200 : 201).send({
      accepted: true,
      status: result.status,
      warnings: result.warnings,
      event: result.event ? publicEvent(result.event) : undefined
    });
  });

  app.get<{ Params: { containerId: string } }>(
    "/api/v1/containers/:containerId/state",
    async (request, reply) => {
      const principal = adminRoutesEnabled ? await requireAdmin(request, reply) : null;
      if (adminRoutesEnabled && !principal) return;
      const tenantId = principal?.tenantId ?? readTenantId(request);
      if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

      const containerEvents = await ledger.eventsForContainer(tenantId, request.params.containerId);
      const scopeFixtures = principal
        ? (dependencies.referenceData ? await dependencies.referenceData(tenantId) : localFixtures) ?? localFixtures
        : localFixtures;
      if (principal && !containerEvents.some((event) => eventVisibleToPrincipal(event, principal, scopeFixtures))) {
        return reply.code(404).send({ error: "NotFound" });
      }
      const visibleContainerEvents = principal
        ? containerEvents.filter((event) => eventVisibleToPrincipal(event, principal, scopeFixtures))
        : containerEvents;
      const state = projectContainer(visibleContainerEvents);
      if (!state) {
        return reply.code(404).send({ error: "NotFound" });
      }

      const corrected = dependencies.correctionAdministration
        ? (await dependencies.correctionAdministration.applyApprovedCorrections(
            tenantId,
            [state]
          ))[0] ?? state
        : state;
      return reply.send(corrected);
    }
  );

  app.get("/api/v1/containers/states", async (request, reply) => {
    const principal = adminRoutesEnabled ? await requireAdmin(request, reply) : null;
    if (adminRoutesEnabled && !principal) return;
    const tenantId = principal?.tenantId ?? readTenantId(request);
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });
    const events = await ledger.eventsForTenant(tenantId);
    const statesFixtures = principal
      ? (dependencies.referenceData ? await dependencies.referenceData(tenantId) : localFixtures) ?? localFixtures
      : localFixtures;
    const visibleEvents = principal
      ? events.filter((event) => eventVisibleToPrincipal(event, principal, statesFixtures))
      : events;
    const containerIds = [...new Set(visibleEvents.map((event) => event.containerId))];
    let items = containerIds
      .map((containerId) =>
        projectContainer(
          visibleEvents.filter((event) => event.containerId === containerId)
        )
      )
      .filter((item) => item !== null);
    if (dependencies.correctionAdministration) {
      items = await dependencies.correctionAdministration.applyApprovedCorrections(
        tenantId,
        items
      );
    }
    return reply.send({ count: items.length, items });
  });

  app.get("/api/v1/review-queue", async (request, reply) => {
    const principal = adminRoutesEnabled ? await requireAdmin(request, reply) : null;
    if (adminRoutesEnabled && !principal) return;
    const tenantId = principal?.tenantId ?? readTenantId(request);
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });
    const items = await ledger.reviewQueue(tenantId);
    if (!principal) return reply.send({ count: items.length, items });
    const reviewFixtures = (dependencies.referenceData ? await dependencies.referenceData(tenantId) : localFixtures) ?? localFixtures;
    const reviewEvents = await ledger.eventsForTenant(tenantId);
    const visibleEventIds = new Set(reviewEvents.filter((event) => eventVisibleToPrincipal(event, principal, reviewFixtures)).map((event) => event.eventId));
    const visibleItems = items.filter((item) => item.appliedEventIds.some((eventId) => visibleEventIds.has(eventId)));
    return reply.send({ count: visibleItems.length, items: visibleItems });
  });

  if (adminRoutesEnabled) {
    app.get("/api/v1/local/reference-data", async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      const fixtures = dependencies.referenceData
        ? await dependencies.referenceData(principal.tenantId)
        : principal.tenantId === localFixtures.tenant.tenantId
          ? localFixtures
          : null;
      if (!fixtures) {
        return reply.code(404).send({ error: "NotFound" });
      }
      const events = await ledger.eventsForTenant(principal.tenantId);
      return reply.send(scopedFixtures(fixtures, principal, events));
    });

    app.get<{ Params: { locationId: string } }>(
      "/api/v1/local/locations/:locationId/dependencies",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const principal = await requireAdmin(request, reply);
        if (!principal) return;
        if (!dependencies.locationAdministration) {
          return reply.code(501).send({ error: "LocationAdministrationUnavailable" });
        }
        if (!requestContextSchema.shape.deviceId.safeParse(request.params.locationId).success) {
          return reply.code(400).send({ error: "InvalidLocationId" });
        }
        if (isScopedPrincipal(principal) && !principalLocationIds(principal)?.has(request.params.locationId)) {
          return reply.code(403).send({ error: "LocationScopeDenied", message: "This account is not assigned to that operating location." });
        }
        const result = await dependencies.locationAdministration.dependencies(
          principal.tenantId,
          request.params.locationId
        );
        if (!result) return reply.code(404).send({ error: "NotFound" });
        return reply.send(result);
      }
    );

    app.post<{ Body: NewLocation }>(
      "/api/v1/local/locations",
      { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
      async (request, reply) => {
        const principal = await requireAdmin(request, reply);
        if (!principal) return;
        if (principal.role !== "organization_owner" && principal.role !== "operations_administrator") {
          return reply.code(403).send({
            error: "InsufficientRole",
            message: "Only Organization Owners and Operations Administrators can add locations."
          });
        }
        if (!dependencies.locationAdministration) {
          return reply.code(501).send({ error: "LocationAdministrationUnavailable" });
        }
        const input = request.body;
        if (
          !input ||
          typeof input.name !== "string" ||
          input.name.trim().length < 2 ||
          input.name.trim().length > 120 ||
          !["donation_express", "store_backroom", "warehouse"].includes(input.type)
        ) {
          return reply.code(400).send({ error: "InvalidLocation", message: "Provide a name and an operating location type." });
        }
        try {
          return reply.code(201).send({
            location: await dependencies.locationAdministration.create(
              principal.tenantId,
              { userId: principal.userId },
              input
            )
          });
        } catch (error) {
          return reply.code(400).send({
            error: "LocationCreateRejected",
            message: error instanceof Error ? error.message : "Location could not be created."
          });
        }
      }
    );

    app.post<{ Params: { locationId: string }; Body: RetireLocationInput }>(
      "/api/v1/local/locations/:locationId/retire",
      { config: { rateLimit: { max: 15, timeWindow: "15 minutes" } } },
      async (request, reply) => {
        const principal = await requireAdmin(request, reply);
        if (!principal) return;
        if (principal.role !== "organization_owner") {
          return reply.code(403).send({
            error: "InsufficientRole",
            message: "Only Organization Owners can retire a location because the action affects historical references."
          });
        }
        if (!dependencies.locationAdministration) {
          return reply.code(501).send({ error: "LocationAdministrationUnavailable" });
        }
        if (!requestContextSchema.shape.deviceId.safeParse(request.params.locationId).success) {
          return reply.code(400).send({ error: "InvalidLocationId" });
        }
        const input = request.body ?? {};
        if (
          (input.replacementLocationId !== undefined &&
            !requestContextSchema.shape.deviceId.safeParse(input.replacementLocationId).success) ||
          (input.moveDevicesToUnknown !== undefined && typeof input.moveDevicesToUnknown !== "boolean") ||
          (input.confirmation !== undefined && typeof input.confirmation !== "string")
        ) {
          return reply.code(400).send({ error: "InvalidLocationRetirement" });
        }
        try {
          return reply.send({
            result: await dependencies.locationAdministration.retire(
              principal.tenantId,
              { userId: principal.userId },
              request.params.locationId,
              input
            )
          });
        } catch (error) {
          const conflict = error as LocationRetireConflict;
          if (conflict?.name === "LocationRetireConflict") {
            return reply.code(409).send({
              error: "LocationRetireBlocked",
              message: conflict.message,
              dependencies: conflict.dependencies
            });
          }
          return reply.code(400).send({
            error: "LocationRetirementRejected",
            message: error instanceof Error ? error.message : "Location could not be retired."
          });
        }
      }
    );

    app.get("/api/v1/local/events", async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      const fixtures = (dependencies.referenceData
        ? await dependencies.referenceData(principal.tenantId)
        : principal.tenantId === localFixtures.tenant.tenantId ? localFixtures : null) ?? localFixtures;
      const visible = (await ledger.eventsForTenant(principal.tenantId))
        .filter((event) => eventVisibleToPrincipal(event, principal, fixtures));
      const events = [...visible]
        .sort(
          (left, right) =>
            Date.parse(right.receivedAt) - Date.parse(left.receivedAt)
        )
        .map(publicEvent);
      return reply.send({ count: events.length, items: events });
    });

    app.post("/api/v1/local/reset", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal || principal.role !== "organization_owner") return reply.code(403).send({ error: "InsufficientRole" });
      if (principal.tenantId !== localFixtures.tenant.tenantId) return reply.code(401).send({ error: "Unauthorized" });
      if (!isResettable(ledger)) {
        return reply.code(501).send({ error: "ResetUnavailable" });
      }
      await ledger.reset();
      return reply.send({ reset: true });
    });

    app.patch<{ Params: { deviceId: string }; Body: DeviceControlUpdate }>(
      "/api/v1/local/devices/:deviceId",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const principal = await requireAdmin(request, reply);
        if (!principal) return;
        if (principal.role !== "organization_owner" && principal.role !== "operations_administrator") {
          return reply.code(403).send({
            error: "InsufficientRole",
            message: "Only Organization Owners and Operations Administrators can change scanner settings."
          });
        }
        const tenantId = principal.tenantId;
        if (!dependencies.deviceAdministration) {
          return reply.code(501).send({ error: "DeviceAdministrationUnavailable" });
        }
        const update = request.body;
        if (
          !update ||
          (update.label === undefined && update.assignedLocationId === undefined && update.isActive === undefined && update.requiredAppVersion === undefined) ||
          (update.label !== undefined && (typeof update.label !== "string" || update.label.trim().length > 120)) ||
          (update.assignedLocationId !== undefined && typeof update.assignedLocationId !== "string") ||
          (update.isActive !== undefined && typeof update.isActive !== "boolean") ||
          (update.requiredAppVersion !== undefined && (typeof update.requiredAppVersion !== "string" || update.requiredAppVersion.trim().length > 32)) ||
          (update.assignmentReason !== undefined && (typeof update.assignmentReason !== "string" || update.assignmentReason.trim().length > 1200))
        ) {
          return reply.code(400).send({ error: "InvalidDeviceUpdate" });
        }
        const fixtures = (dependencies.referenceData
          ? await dependencies.referenceData(principal.tenantId)
          : principal.tenantId === localFixtures.tenant.tenantId ? localFixtures : null);
        const currentDevice = fixtures?.devices.find((device) => device.deviceId === request.params.deviceId);
        const changingLocation = Boolean(
          currentDevice &&
          update.assignedLocationId !== undefined &&
          update.assignedLocationId !== currentDevice.assignedLocationId
        );
        if (changingLocation && principal.role !== "organization_owner") {
          return reply.code(403).send({
            error: "CorporateApprovalRequired",
            message: "Cross-location scanner moves require an Organization Owner approval. Keep the scanner at its current site or ask an Organization Owner to move it."
          });
        }
        if (isLocationManager(principal)) {
          const scope = principalLocationIds(principal);
          if (!currentDevice || !scope?.has(currentDevice.assignedLocationId) ||
              (update.assignedLocationId !== undefined && !scope.has(update.assignedLocationId))) {
            return reply.code(403).send({
              error: "LocationScopeDenied",
              message: "Location Managers can only change scanners assigned to their locations."
            });
          }
        }
        try {
          const device = await dependencies.deviceAdministration.update(
            tenantId,
            request.params.deviceId,
            update,
            { userId: principal.userId, role: principal.role }
          );
          if (!device) return reply.code(404).send({ error: "NotFound" });
          return reply.send({ device });
        } catch (error) {
          return reply.code(400).send({
            error: "DeviceUpdateRejected",
            message: error instanceof Error ? error.message : "Device update rejected."
          });
        }
      }
    );

    // Backwards-compatible alias for the original pilot path. New mobile
    // builds use /api/v1/mobile/telemetry, which is also available in cloud.
    app.patch<{ Params: { deviceId: string }; Body: DeviceTelemetryUpdate }>(
      "/api/v1/local/devices/:deviceId/telemetry",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      handleMobileTelemetry
    );
  }

  return app;
}
