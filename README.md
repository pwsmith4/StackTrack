# StackTrack

StackTrack is an accuracy-first, offline-capable reusable-container tracking system being designed for Goodwill operations. This repository contains a working local API, an internal admin website, and an Expo/React Native field app.

The executable baseline centers on an immutable event ledger, deterministic container-state projection, idempotent event intake, clock and offline-order diagnostics, and a review queue for contradictions. The web and mobile interfaces are functional local prototypes around those contracts.

## Current status

- Shared event contracts and validation
- Append-only in-memory ledger for development and automated tests
- Fastify API for event submission, current state, and review queue
- PostgreSQL migration with tenant isolation, append-only enforcement, idempotency constraints, and correction workflow tables
- Offline scan queue foundation for the Android client
- Goodwill-inspired React admin console with linked operational views
- Expo/React Native field interface with a complete manual scan workflow
- Local mobile web preview and queued offline-observation behavior
- PostgreSQL-backed local API with 120 synthetic containers, 8 locations,
  7 shared scanners, 302 immutable observations, and seeded accuracy-review cases
- Baseline assumptions and unanswered-decision register

This is not production-ready yet. Authentication is intentionally represented by development headers until Goodwill provides an Entra tenant, device provisioning policy, and production Azure environment.

## Run locally

Requirements: Node.js 22 or newer.

```powershell
npm.cmd install
npm.cmd test
npm.cmd run check
npm.cmd run dev
```

Open:

- Admin website: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- React Native web preview: [http://127.0.0.1:8082](http://127.0.0.1:8082)
- API/legacy diagnostic lab: [http://127.0.0.1:3000](http://127.0.0.1:3000)

On Windows, `start-local.cmd` launches all three. Every non-health API request currently requires a development tenant header; event submissions also require a development device header. This header mode must never be enabled in production.

See the [local testing guide](docs/local-testing.md) for seeded labels, offline testing, built-in scenarios, and optional testing from another device on the same private network.

The repository contains the website, mobile app, API, database infrastructure,
and shared packages. See the [deployment layout](docs/deployment.md) before
publishing the admin site through GitHub Pages.

### Start the PostgreSQL simulation

The website and mobile app use PostgreSQL automatically when the local database
is running:

```powershell
npm.cmd run db:start
npm.cmd run db:seed
npm.cmd run db:verify
npm.cmd run dev
```

`db:seed` resets only this development database and recreates the deterministic
simulation. If PostgreSQL is unavailable, the API logs a warning and retains the
small JSON ledger as a fallback. Connection and shutdown instructions are in
`infrastructure/postgres/README.md`.

### Launch the Android cloud test after a restart

Double-click `start-cloud-mobile.cmd` in the repository root. It starts the
Expo Android app with the Azure test API selected. Keep its terminal window open
while testing in the emulator; no local API or local PostgreSQL process is
needed for this cloud-mobile workflow.

### Bootstrap the Azure test database

After creating an Azure Database for PostgreSQL Flexible Server and allowing
your current client IP in its Networking page, initialize its isolated test
database with:

```powershell
npm.cmd run db:azure:bootstrap -- -ServerName "your-server.postgres.database.azure.com" -AdminLogin "your-azure-admin-login"
```

The command prompts for both passwords, applies the schema, creates the
non-admin `stacktrack_app` API login, and loads synthetic test data. It does
not save passwords in the repository.

## First API slice

Submit an immutable observation:

```http
POST /api/v1/events
Content-Type: application/json
X-StackTrack-Tenant-Id: 11111111-1111-4111-8111-111111111111
X-StackTrack-Device-Id: 22222222-2222-4222-8222-222222222222

{
  "eventId": "33333333-3333-4333-8333-333333333333",
  "deviceInstallationId": "44444444-4444-4444-8444-444444444444",
  "deviceSequence": 1,
  "containerId": "55555555-5555-4555-8555-555555555555",
  "loadCodeId": "66666666-6666-4666-8666-666666666666",
  "locationId": "77777777-7777-4777-8777-777777777777",
  "eventType": "load_assigned",
  "eventAt": "2026-07-22T12:00:00.000Z",
  "deviceClockOffsetSeconds": 2.4,
  "clockVerifiedAt": "2026-07-22T11:55:00.000Z"
}
```

Read the projected state:

```http
GET /api/v1/containers/55555555-5555-4555-8555-555555555555/state
X-StackTrack-Tenant-Id: 11111111-1111-4111-8111-111111111111
```

See [baseline assumptions](docs/baseline-assumptions.md), the [decision register](docs/decision-register.md), and the [Goodwill discovery questions](docs/goodwill-discovery-questions.md) before expanding scope.
