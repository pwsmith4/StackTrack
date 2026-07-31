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

This is not production-ready yet. Scanner and test-data routes still use a
synthetic pilot tenant header, but scanner administration and administrator
management now require a server-issued pilot session. Production will replace
the temporary password pilot bridge with Goodwill Microsoft Entra sign-in.

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

For branch-based API deployment to Azure Container Apps, see the
[automatic Azure deployment setup](docs/azure-github-deployment.md). It uses
GitHub OpenID Connect rather than storing an Azure password in GitHub.

The proposed Goodwill-owned access model and production authentication boundary
are documented in the [access-control foundation](docs/access-control-foundation.md).

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

For an Android emulator test against the local PostgreSQL/API environment,
double-click `start-local.cmd`, then use `build-local-android.cmd` once to
install the native debug app. It uses Android's `10.0.2.2` host bridge so the
emulator reports its telemetry to the local Devices page. After that first
build, use `start-local-native-metro.cmd` to reload the installed app during
ordinary emulator testing. Keep both the local stack and Metro windows open.

Use the native debug app rather than Expo Go: it includes StackTrack's native
storage dependency and works with the project's current Expo SDK.

### Version every mobile update

The field app reports its installed semantic version to the admin site whenever
it can reach the API. Before creating a new app build or publishing a mobile
update, run one of these commands from the repository root:

```powershell
npm.cmd run release:mobile:patch  # 0.3.1 → 0.3.2
npm.cmd run release:mobile:minor  # 0.3.1 → 0.4.0
npm.cmd run release:mobile:major  # 0.3.1 → 1.0.0
```

The command updates the Expo manifest, Android Gradle version code/name,
package metadata, and the version bundled into the app together. Commit those
changes with the release. The Devices page shows each scanner's reported installed version and
the exact five-digit scanner identifier. Required-version enforcement remains
available to the mobile/API deployment policy but is intentionally not exposed
as a routine pilot admin toggle.

GitHub Actions also creates a versioned mobile preview on every qualifying push
to `main` or `test`. It adds the GitHub run number and short commit hash, such
as `0.3.1+gh.42.a1b2c3d`, so an administrator can identify the exact source
build on a scanner. The resulting web preview is available in that Actions
run's artifacts. A physical Android scanner receives the new version only when
that build is installed or delivered through the future managed app-update
process.

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

### Enable pilot administrator access

Once the test API is deployed, create the first Organization Owner with the
separate password-prompted command in the
[administrator access setup guide](docs/admin-access-setup.md). This enables
the admin website's sign-in, scanner controls, and administrator directory.

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
