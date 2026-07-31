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
import type { DeviceAdministration, DeviceControlUpdate, DeviceTelemetryUpdate } from "./device-administration.js";
import type { AdminPrincipal, AdminUserUpdate, AuditFilters, NewAdminUser, PostgresAdminAccess } from "./admin-access.js";
import type { PostgresReviewAdministration, ReviewAction } from "./review-administration.js";
import type {
  CorrectionAction,
  CorrectionAdministration,
  NewCorrectionRequest
} from "./correction-administration.js";

export interface AppDependencies {
  readonly ledger?: EventLedger;
  readonly now?: () => Date;
  readonly localMode?: boolean;
  readonly referenceData?: (
    tenantId: string
  ) => LocalFixtures | null | Promise<LocalFixtures | null>;
  readonly deviceAdministration?: DeviceAdministration;
  readonly adminAccess?: PostgresAdminAccess;
  readonly reviewAdministration?: PostgresReviewAdministration;
  readonly correctionAdministration?: CorrectionAdministration;
}

interface ResettableLedger extends EventLedger {
  reset(): void | Promise<void>;
}

type AuditQuery = {
  search?: string;
  locationId?: string;
  deviceId?: string;
  actorUserId?: string;
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

export async function createApp(dependencies: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const ledger = dependencies.ledger ?? new InMemoryEventLedger();
  const now = dependencies.now ?? (() => new Date());
  const localMode = dependencies.localMode ?? false;
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
    options: { allowPendingPasswordChange?: boolean } = {}
  ): Promise<AdminPrincipal | null> => {
    if (!dependencies.adminAccess) {
      reply.code(503).send({ error: "AdminAccessUnavailable", message: "Administrative sign-in has not been provisioned." });
      return null;
    }
    const token = readBearerToken(request);
    const principal = token ? await dependencies.adminAccess.authenticate(token) : null;
    if (!principal) {
      reply.code(401).send({ error: "AdminAuthenticationRequired", message: "Sign in is required for this administrative action." });
      return null;
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

  app.addHook("onSend", async (request, reply, payload) => {
    if (localMode) {
      const origin = firstHeader(request.headers.origin);
      if (origin && browserOrigins.includes(origin)) {
        reply.header("access-control-allow-origin", origin);
        reply.header("vary", "Origin");
        reply.header(
          "access-control-allow-headers",
          "authorization,content-type,cache-control,x-stacktrack-tenant-id,x-stacktrack-device-id"
        );
        reply.header("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
      }
    }
    return payload;
  });

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

    app.get("/api/v1/local/admin/users", async (request, reply) => {
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
      if (query.search !== undefined && query.search.length > 120) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Search text is limited to 120 characters." });
      }
      if (query.actionPrefix !== undefined && !/^[a-z0-9_.-]{1,64}$/i.test(query.actionPrefix)) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Action group is invalid." });
      }
      if (query.targetType !== undefined && !/^[a-z0-9_.-]{1,64}$/i.test(query.targetType)) {
        return reply.code(400).send({ error: "InvalidAuditFilter", message: "Target type is invalid." });
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
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.actionPrefix?.trim() ? { actionPrefix: query.actionPrefix.trim() } : {}),
        ...(query.targetType?.trim() ? { targetType: query.targetType.trim() } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {})
      };
      return reply.send(await dependencies.adminAccess!.searchAuditEntries(filters));
    });

    app.post<{ Body: NewAdminUser }>("/api/v1/local/admin/users", async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (principal.role !== "organization_owner") return reply.code(403).send({ error: "InsufficientRole", message: "Only Organization Owners can add administrators." });
      const input = request.body;
      if (!input || typeof input.username !== "string" || typeof input.displayName !== "string" || typeof input.temporaryPassword !== "string" || !["organization_owner", "operations_administrator", "read_only_reviewer"].includes(input.role)) {
        return reply.code(400).send({ error: "InvalidAdminUser" });
      }
      try {
        return reply.code(201).send({ user: await dependencies.adminAccess!.createUser(principal, input) });
      } catch (error) {
        return reply.code(400).send({ error: "AdminUserRejected", message: error instanceof Error ? error.message : "The user could not be created." });
      }
    });

    app.post("/api/v1/local/admin/session/revoke", async (request, reply) => {
      const principal = await requireAdmin(request, reply, { allowPendingPasswordChange: true });
      const token = readBearerToken(request);
      if (!principal || !token) return;
      await dependencies.adminAccess!.revokeSession(principal, token);
      return reply.code(204).send();
    });

    app.patch<{ Body: { currentPassword?: string; newPassword?: string } }>("/api/v1/local/admin/me/password", async (request, reply) => {
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

    app.patch<{ Params: { userId: string }; Body: AdminUserUpdate }>("/api/v1/local/admin/users/:userId", async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (principal.role !== "organization_owner") return reply.code(403).send({ error: "InsufficientRole", message: "Only Organization Owners can manage administrator accounts." });
      const update = request.body;
      if (!update || (update.displayName !== undefined && typeof update.displayName !== "string") || (update.role !== undefined && !["organization_owner", "operations_administrator", "read_only_reviewer"].includes(update.role)) || (update.isActive !== undefined && typeof update.isActive !== "boolean")) {
        return reply.code(400).send({ error: "InvalidAdminUserUpdate" });
      }
      try {
        return reply.send({ user: await dependencies.adminAccess!.updateUser(principal, request.params.userId, update) });
      } catch (error) {
        return reply.code(400).send({ error: "AdminUserUpdateRejected", message: error instanceof Error ? error.message : "Administrator account could not be updated." });
      }
    });

    app.post<{ Params: { userId: string }; Body: { temporaryPassword?: string } }>(
      "/api/v1/local/admin/users/:userId/password-reset",
      { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
      async (request, reply) => {
        const principal = await requireAdmin(request, reply);
        if (!principal) return;
        if (principal.role !== "organization_owner") {
          return reply.code(403).send({ error: "InsufficientRole", message: "Only Organization Owners can reset administrator passwords." });
        }
        const temporaryPassword = request.body?.temporaryPassword;
        if (typeof temporaryPassword !== "string" || temporaryPassword.length < 12 || temporaryPassword.length > 256) {
          return reply.code(400).send({ error: "InvalidTemporaryPassword", message: "Temporary password must contain 12-256 characters." });
        }
        try {
          return reply.send({ user: await dependencies.adminAccess!.resetUserPassword(principal, request.params.userId, temporaryPassword) });
        } catch (error) {
          return reply.code(400).send({ error: "PasswordResetRejected", message: error instanceof Error ? error.message : "The administrator password could not be reset." });
        }
      }
    );

    app.get("/api/v1/local/review-cases", async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (!dependencies.reviewAdministration) return reply.code(501).send({ error: "ReviewAdministrationUnavailable" });
      return reply.send({ items: await dependencies.reviewAdministration.listCases(principal.tenantId) });
    });

    app.post<{ Params: { reviewCaseId: string }; Body: { action?: ReviewAction; reason?: string } }>("/api/v1/local/review-cases/:reviewCaseId/actions", async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (!dependencies.reviewAdministration) return reply.code(501).send({ error: "ReviewAdministrationUnavailable" });
      const body = request.body;
      if (!body || !["assigned", "approved", "rejected", "resolved", "reopened"].includes(body.action ?? "") || typeof body.reason !== "string") return reply.code(400).send({ error: "InvalidReviewAction" });
      try {
        return reply.send({ item: await dependencies.reviewAdministration.takeAction(principal.tenantId, principal, request.params.reviewCaseId, body.action!, body.reason) });
      } catch (error) {
        return reply.code(400).send({ error: "ReviewActionRejected", message: error instanceof Error ? error.message : "Review action could not be recorded." });
      }
    });

    app.get("/api/v1/local/correction-requests", async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      if (!dependencies.correctionAdministration) {
        return reply.code(501).send({ error: "CorrectionAdministrationUnavailable" });
      }
      return reply.send({
        items: await dependencies.correctionAdministration.listRequests(principal.tenantId)
      });
    });

    app.post<{ Body: NewCorrectionRequest }>(
      "/api/v1/local/correction-requests",
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

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/v1/time", async (request, reply) => {
    const context = readContext(request);
    if (!context) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    return reply.send({ serverAt: now().toISOString() });
  });

  app.post("/api/v1/events", async (request, reply) => {
    const context = readContext(request);
    if (!context) {
      return reply.code(401).send({
        error: "Unauthorized",
        message:
          "Development authentication requires valid tenant and device UUID headers."
      });
    }

    const installationId =
      typeof (request.body as { deviceInstallationId?: unknown } | undefined)?.deviceInstallationId === "string"
        ? (request.body as { deviceInstallationId: string }).deviceInstallationId
        : undefined;
    if (dependencies.deviceAdministration && installationId) {
      const scannerEnabled = await dependencies.deviceAdministration.isScannerEnabled(
        context.tenantId,
        context.deviceId,
        installationId
      );
      if (!scannerEnabled) {
        return reply.code(403).send({
          error: "ScannerDisabled",
          message: "This scanner is disabled or no longer assigned to an active installation."
        });
      }
    }

    const result = await ledger.submit(request.body, context, now());
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
      const principal = localMode ? await requireAdmin(request, reply) : null;
      if (localMode && !principal) return;
      const tenantId = principal?.tenantId ?? readTenantId(request);
      if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

      const state = await ledger.projectionForContainer(
        tenantId,
        request.params.containerId
      );
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
    const principal = localMode ? await requireAdmin(request, reply) : null;
    if (localMode && !principal) return;
    const tenantId = principal?.tenantId ?? readTenantId(request);
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });
    const events = await ledger.eventsForTenant(tenantId);
    const containerIds = [...new Set(events.map((event) => event.containerId))];
    let items = containerIds
      .map((containerId) =>
        projectContainer(
          events.filter((event) => event.containerId === containerId)
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
    const principal = localMode ? await requireAdmin(request, reply) : null;
    if (localMode && !principal) return;
    const tenantId = principal?.tenantId ?? readTenantId(request);
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });
    const items = await ledger.reviewQueue(tenantId);
    return reply.send({ count: items.length, items });
  });

  if (localMode) {
    app.get("/api/v1/mobile/reference-data", async (request, reply) => {
      const context = readContext(request);
      if (!context) return reply.code(401).send({ error: "Unauthorized" });
      const fixtures = dependencies.referenceData
        ? await dependencies.referenceData(context.tenantId)
        : context.tenantId === localFixtures.tenant.tenantId ? localFixtures : null;
      if (!fixtures) return reply.code(404).send({ error: "NotFound" });
      return reply.send(fixtures);
    });

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
      return reply.send(fixtures);
    });

    app.get("/api/v1/local/events", async (request, reply) => {
      const principal = await requireAdmin(request, reply);
      if (!principal) return;
      const events = [...(await ledger.eventsForTenant(principal.tenantId))]
        .sort(
          (left, right) =>
            Date.parse(right.receivedAt) - Date.parse(left.receivedAt)
        )
        .map(publicEvent);
      return reply.send({ count: events.length, items: events });
    });

    app.post("/api/v1/local/reset", async (request, reply) => {
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
      async (request, reply) => {
        const principal = await requireAdmin(request, reply);
        if (!principal) return;
        if (principal.role !== "organization_owner" && principal.role !== "operations_administrator") {
          return reply.code(403).send({
            error: "InsufficientRole",
            message: "Only Organization Owners and Operations Administrators can change scanners."
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
        try {
          const device = await dependencies.deviceAdministration.update(
            tenantId,
            request.params.deviceId,
            update,
            { userId: principal.userId }
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

    app.patch<{ Params: { deviceId: string }; Body: DeviceTelemetryUpdate }>(
      "/api/v1/local/devices/:deviceId/telemetry",
      async (request, reply) => {
        const context = readContext(request);
        if (!context) return reply.code(401).send({ error: "Unauthorized" });
        if (context.deviceId !== request.params.deviceId) {
          return reply.code(403).send({
            error: "DeviceIdentityMismatch",
            message: "A scanner can only report telemetry for its own device identifier."
          });
        }
        if (!dependencies.deviceAdministration) {
          return reply.code(501).send({ error: "DeviceAdministrationUnavailable" });
        }
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
        const device = await dependencies.deviceAdministration.reportTelemetry(
          context.tenantId,
          request.params.deviceId,
          update
        );
        if (!device) return reply.code(404).send({ error: "NotFound" });
        return reply.send({ device });
      }
    );
  }

  return app;
}
