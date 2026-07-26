# StackTrack deployment layout

`C:\Users\Parker\OneDrive\Documents\StackTrack` is the complete StackTrack
monorepo, not only the website.

| Folder | Deployable |
|---|---|
| `apps/admin` | Vite/React administrator website |
| `apps/mobile` | Expo/React Native employee application |
| `apps/api` | Fastify server used by both clients |
| `packages` | Shared event, accuracy, and offline-queue code |
| `infrastructure/postgres` | PostgreSQL schema and local database scripts |

## GitHub Pages

The repository includes `.github/workflows/admin-pages.yml`. It builds and
publishes only `apps/admin/dist` to GitHub Pages. Do not upload the entire source
folder as if it were a prebuilt static website; GitHub Actions must run the Vite
build first.

Before enabling the workflow:

1. Push the entire StackTrack repository to GitHub.
2. In the repository, open **Settings → Pages** and select **GitHub Actions**.
3. Add a repository Actions variable named `STACKTRACK_API_URL`.
4. Set it to the public HTTPS address of the separately deployed Fastify API.

Without `STACKTRACK_API_URL`, the published website builds successfully but
tries to reach `http://127.0.0.1:3000`, which only works on the developer
computer.

GitHub Pages cannot run the Fastify server, PostgreSQL, Expo development server,
or Android application. A production-like test deployment therefore needs:

- GitHub Pages or another static host for `apps/admin`;
- an HTTPS-capable application host for `apps/api`;
- hosted PostgreSQL, such as Azure Database for PostgreSQL Flexible Server;
- an Expo development build or Android package for `apps/mobile`.

The API must allow the final website origin through CORS. Authentication must be
implemented before exposing operational or non-synthetic data publicly.

## Azure synthetic-test environment

The first Azure deployment is deliberately limited to synthetic data while
Goodwill identity and production-integration decisions are outstanding.

1. Create one Azure Database for PostgreSQL Flexible Server at the smallest
   eligible Burstable/32 GiB configuration, add only the developer's current IP
   in Networking, and allowlist `pgcrypto` in Server parameters.
2. Bootstrap it locally without saving credentials to the repository:

   ```powershell
   npm.cmd run db:azure:bootstrap -- -ServerName "<server>.postgres.database.azure.com" -AdminLogin "<admin-login>"
   ```

3. Build the API image from this repository's root `Dockerfile`. The container
   requires `DATABASE_URL` and listens on `PORT` (default 3000).
   The repository includes the `Build StackTrack API test image` GitHub Action,
   which publishes `ghcr.io/<GitHub-owner>/stacktrack-api:main` without Docker
   being installed on the developer PC. After its first successful run, set the
   resulting GitHub Container Registry package to Public so Azure Container Apps
   can pull the test image without storing GitHub credentials.
4. For this temporary synthetic test only, set `STACKTRACK_TEST_MODE=true` in
   the container app. This enables the development header protocol and local
   inspection routes used by the current admin and mobile prototypes. Never use
   it with Goodwill data.
5. Do not deploy real operational data until Microsoft Entra authentication,
   role-based access, app-secret storage, restricted CORS, monitoring, backup,
   and incident procedures are implemented.
