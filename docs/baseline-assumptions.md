# Baseline assumptions

These assumptions make it safe to build before Goodwill-specific discovery is complete. Each is isolated behind configuration, a domain rule, or an adapter.

## Product boundary

1. Year-one means one production pilot store plus a rollout-ready foundation, not all future SaaS features.
2. The tracked asset in the source specification is a reusable container identified by a unique barcode or QR label.
3. Core events are `load_assigned`, `batch_out`, `batch_in`, and `emptied`.
4. Load codes may originate in another system. StackTrack stores both its internal UUID and a future external reference without assuming the external format.
5. A location employee records only the departure origin or the receiving location they can physically verify. The receiving site is unknown until a later `batch_in` scan; StackTrack never treats a planned truck destination as official evidence.

## Accuracy policy

1. Valid observations are append-only. They are not overwritten or silently discarded because they arrive late or conflict with another observation.
2. A duplicate event UUID with an identical payload is an accepted idempotent replay. The same UUID with a different payload is rejected as a client integrity failure.
3. Device event order uses a stable device-installation UUID plus a monotonically increasing sequence. Device time is retained as the employee-observed time but is not the only ordering evidence.
4. The raw device timestamp, a server-calculated effective timestamp, and server receipt time are stored separately. Effective time uses the offset measured during the device's last server handshake; offline duration is never mistaken for clock skew.
5. Measured clock offsets over 10 minutes create a warning. Offsets over 24 hours require administrative review. These thresholds are configurable.
6. Contradictory events are stored, create a review item, and do not silently replace the last unambiguous state.
   A physically observed scan at a different site is still retained as the
   newest location evidence even when the departure was missed; the projection
   moves to the observed site and marks `LocationChangeWithoutDeparture` so
   the missing handoff is visible instead of leaving the container stranded at
   its prior site. A second departure before an arrival is retained and marked
   `RepeatedDepartureBeforeArrival` for review. If a loaded container is
   processed at a different site while its departure is still open, the
   processing scan is retained and marked `ProcessingWithoutReceipt` so the
   system does not imply that a receiving scan occurred.
7. Corrections are new audited records. Ledger events are never updated or deleted.
8. Routine corrections can eventually be delegated to store managers; material corrections require a separate corporate approver. Exact thresholds remain a business decision.

## Technical boundary

1. TypeScript is shared across the API, admin web application, and Android client contracts.
2. PostgreSQL is the system of record; tenant row-level security and tenant-aware foreign keys exist from the first migration.
3. The mobile client will be React Native/Android, but scanner hardware is accessed through an adapter so the first tests can use the camera, keyboard wedge, or simulated input.
4. Local development authentication uses explicit tenant/device headers. Production will use Entra ID for employees and provisioned device credentials for scanners.
5. Azure deployment, Intune packaging, Power BI/Fabric export, alerts, and 24/7 operations are outside this first code slice.
