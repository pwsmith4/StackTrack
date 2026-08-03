import type { AdminPrincipal } from "./admin-access.js";

/**
 * Production integrations are deliberately expressed as small ports.  The
 * pilot can run without any of them, while a Goodwill deployment can provide
 * an adapter without changing event or projection rules.
 */
export interface IdentityProvider {
  /** Validate an external access token and return the already-scoped principal. */
  authenticateAccessToken(token: string): Promise<AdminPrincipal | null>;
}

export interface NotificationProvider {
  /** Deliver an operational or governance notification outside the ledger. */
  notify(input: {
    tenantId: string;
    recipient: string;
    template: string;
    data?: Readonly<Record<string, string | number | boolean | null>>;
  }): Promise<void>;
}

export interface ReportingExporter {
  /**
   * Stream or materialize a report using an already-filtered, read-only row
   * set. Implementations must not mutate operational state.
   */
  exportReport(input: {
    tenantId: string;
    report: string;
    filters: Readonly<Record<string, unknown>>;
    rows: readonly Readonly<Record<string, unknown>>[];
  }): Promise<{ format: "csv" | "xlsx" | "json"; content: string | Uint8Array; fileName: string }>;
}

/** Explicitly useful in tests and local development; it does not pretend to
 * deliver anything to a real provider. */
export class NoopNotificationProvider implements NotificationProvider {
  public async notify(_input: Parameters<NotificationProvider["notify"]>[0]): Promise<void> {
    return undefined;
  }
}
