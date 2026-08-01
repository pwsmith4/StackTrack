# Location administration

Location changes are intentionally governed because locations are referenced by
devices, load codes, and immutable observation history.

## Add a location

Organization Owners and Operations Administrators can add a Store, Donation
Xpress, or Warehouse from the **Locations → Location administration** panel.
The new location is written to PostgreSQL and appears in the next reference-data
refresh, including the scanner assignment dropdown.

## Retire a location

Retirement is a soft close, not a destructive delete. The console first loads a
dependency review showing:

- scanners currently assigned to the site;
- scoped administrators currently assigned to the site;
- containers whose latest recorded observation is there;
- load codes generated there; and
- the number of immutable observations that mention the site.

The Organization Owner must type the exact location name to confirm. Scanners
should normally be moved individually first. If a scanner cannot be updated,
the owner can move remaining scanners to the system-managed **Unknown location**
or choose another active site. Every move creates assignment history and an audit
event. No old scan, load-code origin, or event location is rewritten.

Retirement is blocked while a Location Manager or scoped Read-only Reviewer
still includes the site in their scope. Open **Settings -> Administrator
directory**, reassign each scoped user to their remaining operating sites (or
change their role), then rerun the dependency check. StackTrack never silently
removes a person's access.

Retired names remain in reference data so historical records stay readable, but
they are removed from new operating-location and scanner-assignment choices.

## Location workspaces and scanner moves

The corporate Locations landing page is a network directory. Selecting a site
opens a focused workspace at `#/locations/{locationId}` with independent lanes
for containers currently there, arriving, and leaving, plus local scanners,
recent observations, review cases, freshness, and data-quality signals. The
lanes are intentionally independent: a container can visit several warehouses
before reaching a store, and the lifecycle view keeps each recorded hop in
order.

Low-risk scanner controls (rename, enable, and disable) take effect immediately
and are audited. A move between locations is different because it changes the
operating boundary for future scans. The API therefore permits an immediate
cross-location move only to an Organization Owner; Operations Administrators
and Location Managers receive a clear corporate-approval response and no
partial update is written. A Location Manager can still manage scanners at an
assigned site, while a scoped Read-only Reviewer can inspect only their
assigned sites.

## Azure permission repair

The API role needs column-level update permission for governed location changes.
After deploying this feature to an existing database, run
`REPAIR-AZURE-DATABASE-PERMISSIONS.cmd` once with the Azure PostgreSQL
administrator password. The script is safe to rerun and does not change data.
