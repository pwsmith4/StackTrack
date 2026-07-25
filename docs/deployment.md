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
