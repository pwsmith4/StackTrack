import type { Pool, PoolClient } from "pg";
import type { AdminPrincipal } from "./admin-access.js";

export type ReviewAction = "assigned" | "approved" | "rejected" | "resolved" | "reopened";

export interface ReviewCase {
  readonly reviewCaseId: string;
  readonly containerId: string;
  readonly containerLabel: string;
  readonly reasonCode: string;
  readonly evidenceEventIds: string[];
  readonly openedAt: string;
  readonly status: "opened" | ReviewAction;
  readonly lastActionAt: string | null;
  readonly lastActionReason: string | null;
  readonly actionCount: number;
}

function toIso(value: Date | string | null): string | null { return value ? new Date(value).toISOString() : null; }

export class PostgresReviewAdministration {
  public constructor(private readonly pool: Pool) {}
  private async transaction<T>(tenantId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]); const result = await action(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  private map(row: Record<string, unknown>): ReviewCase {
    return { reviewCaseId: String(row.review_case_id), containerId: String(row.container_id), containerLabel: String(row.container_label), reasonCode: String(row.reason_code), evidenceEventIds: row.evidence_event_ids as string[], openedAt: toIso(row.opened_at as Date | string)!, status: (row.latest_action ?? "opened") as ReviewCase["status"], lastActionAt: toIso(row.latest_action_at as Date | string | null), lastActionReason: row.latest_action_reason ? String(row.latest_action_reason) : null, actionCount: Number(row.action_count ?? 0) };
  }
  private async select(client: PoolClient, tenantId: string, reviewCaseId?: string): Promise<ReviewCase[]> {
    const result = await client.query(
      `SELECT rc.review_case_id, rc.container_id, c.container_label, rc.reason_code, rc.evidence_event_ids, rc.opened_at,
              latest.action::text AS latest_action, latest.occurred_at AS latest_action_at, latest.reason AS latest_action_reason,
              action_summary.action_count
         FROM review_cases rc JOIN containers c ON c.tenant_id=rc.tenant_id AND c.container_id=rc.container_id
         LEFT JOIN LATERAL (SELECT action, occurred_at, reason FROM review_case_actions WHERE tenant_id=rc.tenant_id AND review_case_id=rc.review_case_id ORDER BY occurred_at DESC, review_action_id DESC LIMIT 1) latest ON true
         LEFT JOIN LATERAL (SELECT count(*)::int AS action_count FROM review_case_actions WHERE tenant_id=rc.tenant_id AND review_case_id=rc.review_case_id) action_summary ON true
        WHERE rc.tenant_id=$1 ${reviewCaseId ? "AND rc.review_case_id=$2" : ""}
        ORDER BY COALESCE(latest.occurred_at, rc.opened_at) DESC, rc.opened_at DESC`,
      reviewCaseId ? [tenantId, reviewCaseId] : [tenantId]
    );
    return result.rows.map((row) => this.map(row));
  }
  public async listCases(tenantId: string): Promise<ReviewCase[]> { return this.transaction(tenantId, (client) => this.select(client, tenantId)); }
  public async takeAction(tenantId: string, actor: AdminPrincipal, reviewCaseId: string, action: ReviewAction, reasonInput: string): Promise<ReviewCase> {
    const reason = reasonInput.trim();
    if (reason.length < 8 || reason.length > 1200) throw new Error("A review decision needs a clear reason of 8-1200 characters.");
    if (actor.role === "read_only_reviewer" || actor.role === "support") throw new Error("Your administrator role cannot change review cases.");
    if (actor.role !== "organization_owner" && action !== "assigned" && action !== "reopened") throw new Error("Only an Organization Owner can make an approval, rejection, or resolution decision.");
    return this.transaction(tenantId, async (client) => {
      const exists = await client.query(`SELECT review_case_id FROM review_cases WHERE tenant_id=$1 AND review_case_id=$2`, [tenantId, reviewCaseId]);
      if (!exists.rows[0]) throw new Error("Review case was not found.");
      await client.query(`INSERT INTO review_case_actions (tenant_id, review_case_id, action, actor_type, actor_id, reason) VALUES ($1,$2,$3,'user',$4,$5)`, [tenantId, reviewCaseId, action, actor.userId, reason]);
      await client.query(`INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target_type, target_id, details) VALUES ($1,'user',$2,$3,'review_case',$4,$5::jsonb)`, [tenantId, actor.userId, `review.${action}`, reviewCaseId, JSON.stringify({ reason, source: "admin_console" })]);
      return (await this.select(client, tenantId, reviewCaseId))[0]!;
    });
  }
}
