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
- containers whose latest recorded observation is there;
- load codes generated there; and
- the number of immutable observations that mention the site.

The Organization Owner must type the exact location name to confirm. Scanners
should normally be moved individually first. If a scanner cannot be updated,
the owner can move remaining scanners to the system-managed **Unknown location**
or choose another active site. Every move creates assignment history and an audit
event. No old scan, load-code origin, or event location is rewritten.

Retired names remain in reference data so historical records stay readable, but
they are removed from new operating-location and scanner-assignment choices.

## Azure permission repair

The API role needs column-level update permission for governed location changes.
After deploying this feature to an existing database, run
`REPAIR-AZURE-DATABASE-PERMISSIONS.cmd` once with the Azure PostgreSQL
administrator password. The script is safe to rerun and does not change data.
