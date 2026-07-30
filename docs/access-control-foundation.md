# Access-control foundation

StackTrack will use Goodwill-owned identities and tenant-scoped permissions. A
password embedded in the public admin website is not authentication: anyone can
read it from the downloaded JavaScript, and the current development API accepts
test headers. Do not use the public GitHub Pages build for real operational
access control.

## Recommended roles

| Role | Purpose | Can manage users? | Can operate the admin console? |
| --- | --- | --- | --- |
| **Organization Owner** | Goodwill corporate authority for the tenant. At least two people should hold this role: the operational program owner and the Chief of IT. | Yes | Yes |
| **Operations Administrator** | Daily operational and device management. | No | Yes |
| **Read-only reviewer** | Audit, reporting, and exception review without changes. | No | View only |
| **StackTrack Support** | Time-limited, explicitly approved vendor troubleshooting access. | No | Only the granted scope |

There is no hidden developer super-admin. Goodwill should retain the ability to
remove the original implementer and all other users. Support access must be
created by an Organization Owner, expire automatically, and be written to the
audit log.

## Production authentication design

1. Register StackTrack in Goodwill's Microsoft Entra tenant.
2. The web app signs users in with Entra and obtains a short-lived access token.
3. The API verifies that token server-side and maps its Entra object ID to a
   tenant user and role stored in PostgreSQL.
4. Every write includes the authenticated actor ID in the append-only audit
   record. The client never supplies an actor ID or role.
5. Device scanners use a separate device credential/provisioning path; an
   administrator sign-in does not turn a scanner into an admin device.

## Local-only development login

For local tests only, a bootstrap user may be created with username `root` and
password `password`. It must be enabled only through local environment
configuration, never committed, never included in a GitHub Pages build, and
never deployed to Azure. The first successful local sign-in should require a
password change.

## Preconditions before activating sign-in

- The Azure test API deployment pipeline must be healthy.
- The API must stop accepting the current development tenant/device headers for
  administrative routes.
- The admin site must be hosted behind an application/API that can verify
  server-side authentication, rather than relying on static GitHub Pages alone.
- Goodwill must provide its Entra tenant and decide the initial Organization
  Owners.
