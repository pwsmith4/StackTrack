import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
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

export interface AppDependencies {
  readonly ledger?: EventLedger;
  readonly now?: () => Date;
  readonly localMode?: boolean;
  readonly referenceData?: (
    tenantId: string
  ) => LocalFixtures | null | Promise<LocalFixtures | null>;
  readonly deviceAdministration?: DeviceAdministration;
}

interface ResettableLedger extends EventLedger {
  reset(): void | Promise<void>;
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

function publicEvent(event: StoredEvent) {
  const { canonicalPayload: _canonicalPayload, ...result } = event;
  return result;
}

export function createApp(dependencies: AppDependencies = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const ledger = dependencies.ledger ?? new InMemoryEventLedger();
  const now = dependencies.now ?? (() => new Date());
  const localMode = dependencies.localMode ?? false;

  app.addHook("onSend", async (_request, reply, payload) => {
    if (localMode) {
      reply.header("access-control-allow-origin", "*");
      reply.header(
        "access-control-allow-headers",
        "content-type,cache-control,x-stacktrack-tenant-id,x-stacktrack-device-id"
      );
      reply.header("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
    }
    return payload;
  });

  if (localMode) {
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
      const tenantId = readTenantId(request);
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const state = await ledger.projectionForContainer(
        tenantId,
        request.params.containerId
      );
      if (!state) {
        return reply.code(404).send({ error: "NotFound" });
      }

      return reply.send(state);
    }
  );

  app.get("/api/v1/containers/states", async (request, reply) => {
    const tenantId = readTenantId(request);
    if (!tenantId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const events = await ledger.eventsForTenant(tenantId);
    const containerIds = [...new Set(events.map((event) => event.containerId))];
    const items = containerIds
      .map((containerId) =>
        projectContainer(
          events.filter((event) => event.containerId === containerId)
        )
      )
      .filter((item) => item !== null);
    return reply.send({ count: items.length, items });
  });

  app.get("/api/v1/review-queue", async (request, reply) => {
    const tenantId = readTenantId(request);
    if (!tenantId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const items = await ledger.reviewQueue(tenantId);
    return reply.send({ count: items.length, items });
  });

  if (localMode) {
    app.get("/api/v1/local/reference-data", async (request, reply) => {
      const tenantId = readTenantId(request);
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const fixtures = dependencies.referenceData
        ? await dependencies.referenceData(tenantId)
        : tenantId === localFixtures.tenant.tenantId
          ? localFixtures
          : null;
      if (!fixtures) {
        return reply.code(404).send({ error: "NotFound" });
      }
      return reply.send(fixtures);
    });

    app.get("/api/v1/local/events", async (request, reply) => {
      const tenantId = readTenantId(request);
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const events = [...(await ledger.eventsForTenant(tenantId))]
        .sort(
          (left, right) =>
            Date.parse(right.receivedAt) - Date.parse(left.receivedAt)
        )
        .map(publicEvent);
      return reply.send({ count: events.length, items: events });
    });

    app.post("/api/v1/local/reset", async (request, reply) => {
      const tenantId = readTenantId(request);
      if (tenantId !== localFixtures.tenant.tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      if (!isResettable(ledger)) {
        return reply.code(501).send({ error: "ResetUnavailable" });
      }
      await ledger.reset();
      return reply.send({ reset: true });
    });

    app.patch<{ Params: { deviceId: string }; Body: DeviceControlUpdate }>(
      "/api/v1/local/devices/:deviceId",
      async (request, reply) => {
        const tenantId = readTenantId(request);
        if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });
        if (!dependencies.deviceAdministration) {
          return reply.code(501).send({ error: "DeviceAdministrationUnavailable" });
        }
        const update = request.body;
        if (
          !update ||
          (update.label === undefined && update.assignedLocationId === undefined && update.isActive === undefined && update.requiredAppVersion === undefined) ||
          (update.label !== undefined && typeof update.label !== "string") ||
          (update.assignedLocationId !== undefined && typeof update.assignedLocationId !== "string") ||
          (update.isActive !== undefined && typeof update.isActive !== "boolean") ||
          (update.requiredAppVersion !== undefined && typeof update.requiredAppVersion !== "string") ||
          (update.assignmentReason !== undefined && typeof update.assignmentReason !== "string")
        ) {
          return reply.code(400).send({ error: "InvalidDeviceUpdate" });
        }
        try {
          const device = await dependencies.deviceAdministration.update(
            tenantId,
            request.params.deviceId,
            update
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
        const tenantId = readTenantId(request);
        if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });
        if (!dependencies.deviceAdministration) {
          return reply.code(501).send({ error: "DeviceAdministrationUnavailable" });
        }
        const update = request.body;
        if (
          !update ||
          typeof update.installationId !== "string" ||
          typeof update.appVersion !== "string" ||
          !Number.isInteger(update.pendingOfflineScanCount) ||
          update.pendingOfflineScanCount < 0
        ) {
          return reply.code(400).send({ error: "InvalidDeviceTelemetry" });
        }
        const device = await dependencies.deviceAdministration.reportTelemetry(
          tenantId,
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
