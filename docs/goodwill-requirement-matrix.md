# Goodwill revised requirements - implementation matrix

This matrix maps the revised wording in
`StackTrack_Exact_Updated_Verbiage_Changes.docx` to the current pilot
implementation. "Complete" means the behavior is implemented and covered by
automated checks. "Gated" means the code has a safe seam or pilot behavior,
but Goodwill must provide an external fact before it can be connected to a
real system or device.

## Product and data model

| Revised requirement | Current implementation | Verification | State |
| --- | --- | --- | --- |
| Track reusable bins, carts, and gaylords filled with donated goods | Tenant-scoped containers, locations, goods types, projections, and load-code records are represented in the domain and PostgreSQL ledger. | `packages/domain/test/ledger.test.ts`, `apps/api/test/app.test.ts`, admin container/location workspaces | Complete for pilot data |
| Replace paper with durable history and current state | Append-only event ledger, deterministic projection, review queue, audit trail, and read-only reports are in place. | Full suite; `docs/architecture.md`, `docs/reporting-foundation.md` | Complete for pilot behavior |
| Load code traces donation origin into production | Generate Load Code captures goods type, secondary value, origin location, device, times, and a unique load-code ID; the API now rejects missing classification fields. | Domain validation test; mobile workflow; PostgreSQL `load_codes` write | Pilot integration gated by production-system contract |

## Mobile application and scanner behavior

| Revised requirement | Current implementation | Verification | State |
| --- | --- | --- | --- |
| Expo/React Native Android application | Native Expo app with Android build configuration, branded launch screen, shared-device controls, web preview, and an honest handheld-first scan flow. The UI does not claim camera scanning is available; it offers the attached scanner bridge or printed-label entry. Scan and load-code controls stay unavailable until an approved container reference list is available. | `npm run check --workspace @stacktrack/mobile`; `npm run export:web --workspace @stacktrack/mobile`; mobile reference-data tests | Complete for pilot shell; exact hardware bridge gated |
| Unitech handheld scanner integration | Scanner adapter seam supports keyboard-wedge and Unitech-intent decoded values without guessing a vendor broadcast action. | `apps/mobile/test/scanner.test.ts` | Gated on exact Unitech model, Android version, intent/action, extras, and MDM policy |
| Every scanner is assigned to one operating location | Device reference data carries `assignedLocationId`; cloud API validates assignment and derives a departure origin from it. | API assignment and location-mismatch tests; PostgreSQL device administration | Complete when production device rows are provisioned |
| Offline-first durable queue and idempotent replay | Native SecureStore-chunked queue (AsyncStorage web fallback), stable installation UUID, per-device sequence, retry/review status, and idempotent event UUIDs. Immediate uploads and queued replay send tenant, device, and installation identity headers. A real cloud response is never replaced with synthetic fixtures; only loopback/no-response preview mode may use generated data. A cached reference set and explicit cached permission response can support an intentional offline session across transient outages; 401/403 or unreadable permission data clears the cached authorization state. | `apps/mobile/test/sync.test.ts`, `apps/mobile/test/clock.test.ts`, `apps/mobile/test/device-network.test.ts`, `apps/mobile/test/reference-data.test.ts`, `packages/offline-queue/test/offline-queue.test.ts` | Complete for pilot behavior; device credential provider gated |
| One item must not block a batch | Batch out/in accepts 1-N items, returns indexed results, isolates unexpected item failures, and marks retryable failures for independent mobile replay. | API batch tests; mobile classifier test | Complete for pilot behavior |

## Location and movement model

| Revised requirement | Current implementation | Verification | State |
| --- | --- | --- | --- |
| Batch-out records origin and in-transit sentinel only | Mobile does not ask for a destination; server overwrites/validates departure origin from device assignment and projects a defined `In transit` location. | Domain destination rejection; API departure-origin tests; admin movement rendering | Complete |
| Batch-in confirms receiving location from the device | Receiving action is available as a batch; assigned device location is authoritative and manual destination fields are rejected. | API assignment/mismatch tests; mobile workflow | Complete for pilot behavior |
| Multi-hop journeys remain honest | An arrival closes the open departure at the arrival site; no planned destination is trusted from old payloads. | Projection tests and destination-payload rejection test | Complete for the current evidence model |

## Least privilege and governance

| Revised requirement | Current implementation | Verification | State |
| --- | --- | --- | --- |
| Named device permission keys resolved from device role | Migration 006 defines permission keys and role grants; PostgreSQL administration resolves them per installation. The mobile control plane resolves permissions before reference data, caches the explicit response, gates recording/lookup controls, and the cloud server still enforces every permission server-side. Cloud strict mode fails closed; missing configuration returns 503 rather than implicit access. A cold mobile start begins unavailable until it has a cached or explicit permission response. | API strict-permission regression; mobile permission bootstrap tests; `apps/mobile/test/device-network.test.ts`; migration/grant scripts | Complete for configured cloud roles; exact hardware authentication remains gated |
| No permission is assumed | Local test doubles can opt into compatibility mode only; production `server.ts` sets `strictDevicePermissions: true`. | API strict-permission regression | Complete |
| Web permissions resolved per request from tenant role | `requireAdmin` authenticates each request; location managers are scoped to assigned locations; owner-only actions and approval separation are enforced server-side. When an `IdentityProvider` is configured, the governed administrator read/write routes are available in cloud mode while the pilot password bridge remains disabled. | API role/scope/correction/location tests; cloud identity-provider route regression; `docs/access-control-foundation.md` | Complete for pilot roles; production identity/group mapping remains gated |
| Replaceable integrations | `IdentityProvider`, `NotificationProvider`, and `ReportingExporter` are explicit ports. Identity bearer authentication is exercised through the adapter; no core ledger logic depends on a provider. | API identity-provider regression; `apps/api/src/integration-ports.ts` | Adapter seam complete; Goodwill provider wiring gated |

## Core workflows

| Revised workflow | Current implementation | Verification | State |
| --- | --- | --- | --- |
| Generate Load Code | Scan, choose goods type, choose conditional secondary value, review, persist `load_assigned`; load lookup is read-only. | Domain/API classification validation; mobile workflow; load-code lookup route | Complete for pilot behavior; production handoff gated |
| Batch Out | Collect 1-N labels at assigned departure site; save per-container `batch_out`; show in-transit leaving-origin state. | API batch tests; mobile batch review and per-item persistence | Complete |
| Batch In | Collect 1-N arriving labels at receiving device; use device assignment as location; return per-item results. | API location enforcement; mobile batch review | Complete for pilot behavior |
| Mark Empty | Scan and choose 100/80/65/50 percent processed; event carries percentage. PostgreSQL writes `emptied` and `processed_loads` in one transaction. | Domain processed-percentage test; migration 005; PostgreSQL transaction code | Complete for pilot behavior |
| Load Code Lookup replaces Message/Note | Mobile no longer captures scanner free text; lookup is read-only, cache-backed, and shows synchronization time. Admin message filters/columns/panels were removed; legacy payloads remain readable. | Admin/mobile checks and full suite | Complete |

## Reliability and operations

| Area | Current implementation | Remaining gate |
| --- | --- | --- |
| Time evidence | Observed, effective, and received times; clock offset and sequence warnings remain separate from offline delay. | Confirm Goodwill's clock tolerance and correction authority. |
| Auditability | Immutable scanner activity is separate from administrative Audit Trail; correction decisions retain actor, reason, and evidence. | Confirm retention period and export/notification recipients. |
| Admin recovery | Local pilot sign-in, password change/reset flows, access-help request, rate limits, roles, scoped locations, device controls, and audit records exist. | Production Entra groups, MFA/conditional access, recovery ownership, and support process. |
| Reporting | Filtered read-only CSV/report workspaces exist, with exporter port reserved for analytics integration. | Exact daily/weekly report columns, Excel/Fabric destination, schedule, and reconciliation authority. |
| Deployment | Local PostgreSQL, Azure PostgreSQL, cloud API container, GitHub Pages admin, and mobile test workflow are supported. | Goodwill subscription/tenant/network/MDM/security approval and release ownership. |

## Deliberately not invented

The implementation does not guess the following facts: exact Unitech hardware
protocol, production load-code owner/API, barcode symbology and label lifecycle,
allowed event shortcuts, partial-load business meaning, employee identity on
shared scanners, route/receipt service-level rules, Entra group mapping,
notifications, analytics destination, retention, RPO/RTO, or pilot success
metrics. Those are operational contracts, not safe UI defaults. The open list is
maintained in `docs/goodwill-discovery-questions.md`.
