# Local testing guide

The local StackTrack baseline exercises the reusable-container workflow without Azure, Entra ID, Fabric, the production system, or a Goodwill network connection.

## Start it on Windows

Double-click `start-local.cmd`, or run:

```powershell
cd C:\Users\Parker\OneDrive\Documents\StackTrack
npm.cmd install
npm.cmd run db:start
npm.cmd run db:seed
npm.cmd run dev
```

Leave that terminal open. The three local surfaces are:

| Surface | Address | Purpose |
|---|---|---|
| Admin website | http://127.0.0.1:5173 | Network overview, containers, load codes, locations, review, audit activity, devices, and reports |
| React Native web preview | http://127.0.0.1:8082 | Employee/shared-scanner workflow |
| Local API lab | http://127.0.0.1:3000 | API and legacy diagnostic interface |

The API reads and writes the local PostgreSQL `stacktrack` database and the data
survives a server restart. If PostgreSQL is stopped, the API clearly logs that it
has switched to the smaller `apps/api/.local-data/ledger.json` fallback. Do not
enter real Goodwill data; local mode intentionally uses development identities
instead of production authentication.

### Android emulator

With a Pixel emulator running and Expo Go installed:

```powershell
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8082 tcp:8082
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8082"
```

The emulator needs an Expo Go version compatible with SDK 57. Expo’s supported downloader is `npx expo-go download android 57`; install the resulting APK on the emulator with `adb install -r <apk-path>`.

## Recommended end-to-end check

1. Open the mobile preview.
2. Choose **Scan container**.
3. Enter `B1004`.
4. Choose **Mark full**.
5. Select a goods type and quality, review the evidence, and save.
6. Note the generated `ST-...` load code.
7. Open the admin website, choose **Load codes**, and refresh.
8. Confirm the exact load code and container appear in the validated list.

To test offline capture, open **Settings** in the mobile preview, enable **Simulate offline**, and save another observation. It remains queued on the device. Disable offline mode and choose **Retry** beside the local API to synchronize it.

## What can be tested now

- Four core observations: mark full, send out, receive, and mark empty
- 120 seeded reusable-container labels across bin, cart, and gaylord types
- Eight simulated locations and seven location-locked shared scanners
- Shared physical-device identities locked to a location
- Goods type and secondary classification selection
- Offline-safe UUID-derived human-readable load codes, with a server duplicate guard
- Device timestamps, stable sequence numbers, and event UUIDs
- Offline event persistence and later synchronization
- Exact duplicate handling and immutable receipt history
- A seeded conflicting-load example in the admin review queue
- Current state projection and latest valid observation
- Admin navigation, responsive layout, CSV/report placeholders, and device status
- Persistence after stopping and restarting the local API
- PostgreSQL schema migration, row-level tenant isolation, and append-only database controls

## Production-like PostgreSQL lab

PostgreSQL 16 and pgAdmin are already installed on this development machine. The project uses an isolated local cluster instead of the disabled global Windows service:

```powershell
npm.cmd run db:start
npm.cmd run db:verify
```

The verification proves that the restricted application role sees no tenant data until a transaction sets `app.tenant_id`, then sees only the selected tenant. It also checks forced row-level security and the append-only database triggers. See `infrastructure/postgres/README.md` for connection details and shutdown instructions.

## Test from another device on the same private network

The default services bind only to this computer. Before field-device testing, the Vite and Expo hosts and the API URL must be configured for the computer’s private network address. Windows may ask whether Node.js can accept private-network traffic. Do not expose these development services to the public internet.

## Deliberately mocked boundaries

| Production dependency | Local substitute |
|---|---|
| Azure Database for PostgreSQL | Local PostgreSQL 16 using the same schema and restricted application role |
| Device authentication | Fixed local tenant/device identities |
| Entra administrator login | Prototype corporate-administrator profile |
| Unitech scanner SDK / camera | Typed label entry and keyboard-wedge-compatible input |
| Production-system integration | Local load-code generation and validated admin list |
| Microsoft Fabric / data lake | Reports and integration placeholders |
| Enterprise reference data | PostgreSQL-seeded locations, devices, containers, and goods types |

The event contracts, ordering evidence, conflict rules, offline queue, and projection logic are the production-oriented foundation. Connecting real services later replaces local adapters rather than rewriting the tested rules.

## Remaining pilot boundaries

- Camera-based QR recognition and physical Unitech hardware integration
- Entra login and employee session identity (the isolated pilot uses a
  server-issued password session)
- Push notifications and escalation reminders for pending approvals
- Real production-system and Microsoft analytics integrations
- Printing labels or load codes
- Enterprise mobile provisioning and multi-store rollout tooling

PostgreSQL is the runtime source of truth for the local and Azure test APIs.
Remote scanner assignment/availability, review decisions, administrator access,
and governed correction approval are implemented in the pilot.
