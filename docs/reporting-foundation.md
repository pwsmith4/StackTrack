# Reporting and data-health foundation

The Reports & data workspace is an investigation tool, not a second source of
truth. It reads immutable scanner observations, the current container
projection, scanner telemetry, correction requests, and the append-only audit
trail. A download should be reproducible from the selected scope and should
never modify operational state.

## What each report is for

| Report | Answers | Good use | Do not infer |
| --- | --- | --- | --- |
| Movement ledger | Which observations were recorded, where, by which scanner, and when they reached the service? | Reconstruct a container route or explain an out-of-order event. | A clean row proves the physical scan was performed correctly. |
| Load-code handoff | Which filled containers generated a production-facing load code? | Reconcile a store’s daily handoff with the production system. | A load code means the destination has received the container. |
| Data-quality exceptions | Which projections or observations need a human decision? | Triage conflicts, timing flags, and unresolved evidence. | A warning means the container is lost. |
| Correction register | Which official-state changes were requested, decided, and why? | Review owner approvals, rejected requests, and open work. | A correction deletes the original observation. |
| Scanner coverage | Which scanners are enabled, assigned, current on app version, and recently reporting? | Distinguish a quiet location from a stale or disabled scanner. | A recent heartbeat proves the scanner was in the assigned building. |
| Location throughput | How many observations and distinct containers touched each location? | Compare workload and identify locations with unusual flag rates. | Higher volume alone means better performance. |
| Transit aging | Which containers are still between locations and how long has the receipt been outstanding? | Call a destination about an aging delivery or missing receipt. | Age is automatically a service-level breach; routes may be intentionally held. |
| Scan latency | How long did each scanner’s observations take to upload? | Separate offline queue behavior from service/device problems. | A delayed upload is automatically inaccurate. |
| Governance actions | Who signed in, changed a scanner, requested a correction, or made a decision? | Accountability, investigations, and compliance review. | It replaces the physical Activity feed. |

## Filters and scope semantics

The page uses an explicit **Apply report scope** step so a partially edited
filter cannot silently change a download. Search matches identifiers, labels,
locations, scanners, event names, and evidence flags. Location includes the
virtual **In transit** location because it is essential for route aging.

- **Date range** uses the event time for observations, request time for
  corrections, last report time for scanners, and occurrence time for audit
  actions.
- **Scanner** and **location** filter the physical evidence and are also used
  to narrow related projections. A projection can remain in scope when one of
  its historical observations matches the selected location.
- **Admin / requester** applies to governance and correction reports. It is not
  applied to scanner observations because a device observation has a device
  identity, not an administrator actor.
- **Data health** filters projections by their current evidence decision:
  clean, warning, or needs review.
- **Registration coverage** is tenant-wide unless event filters are cleared;
  an unobserved container has no event location or event date to join safely.

Every CSV includes enough identifiers to trace back to the detail drawer or
Audit trail. Exporting a report is read-only.

## Data health in operational terms

Data health is a set of evidence-quality signals. It is not a percentage of
containers that StackTrack can guarantee are physically correct.

1. **Observation integrity** is the share of matching events without timing,
   sequence, or device-order flags. Use it to find late offline uploads,
   duplicate scans, or device clocks that make a route appear out of order.
2. **Projection decisions** counts containers whose latest evidence has a
   warning or unresolved conflict. Use it to prioritize a governed correction;
   the original events remain visible.
3. **Scanner freshness** is the share of matching scanners that reported in the
   last 24 hours. Use it before treating a quiet location as proof that no
   movement occurred.
4. **Registration coverage** counts registered containers with no accepted
   observation. Use it during label provisioning and rollout verification;
   never invent a location or an empty state from the absence of evidence.
5. **Upload latency** counts events received more than 15 minutes after they
   were recorded. Use it with scanner freshness and the offline queue to decide
   whether the delay is expected field work or a service/device incident.

## Recommended authority model

StackTrack should serve both corporate administrators and local managers, with
different scopes:

- Corporate Operations Administrators can investigate and operate across the
  network.
- Organization Owners govern users and approve material corrections with dual
  control.
- A proposed **Location Manager** role can operate only assigned stores,
  Donation Xpress sites, or warehouses. It can disable a local scanner and
  submit a correction request, but must provide a reason and cannot approve its
  own material correction or change global policy.

The API must enforce location scope and approval separation. The browser should
only make the distinction visible; it must never be the security boundary.

