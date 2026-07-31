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

## Pilot password login

For the isolated Azure test pilot, an Organization Owner can be bootstrapped by
an administrator-run script that prompts for a password and stores only a
PBKDF2-SHA-512 password hash in PostgreSQL. The password is never committed or
put in the GitHub Pages build. The default *username* can be `root`, but the
password must be a unique 12+ character value, not `password`.

The pilot implementation now enforces these boundaries server-side:

- the public admin page renders no tenant data until the API verifies a session;
- browser API access is allowlisted to the StackTrack web origins, and sign-in
  attempts are limited to five per fifteen minutes per client address;
- sessions expire after 12 hours, can be explicitly signed out, and are revoked
  immediately if the account is disabled or its role changes;
- an administrator created with a temporary password cannot view or manage
  pilot operations until they replace it with their own 12+ character password;
- Organization Owners can add a second Organization Owner (for example, the
  Goodwill Chief of IT), Operations Administrators, and Read-only Reviewers;
- StackTrack will not allow the final active Organization Owner to be disabled
  or demoted; and
- scanner moves, renames, availability changes, account changes, password
  changes, and review decisions all write an authenticated actor to `audit_log`.

This is still a test-pilot password bridge, not the production Entra design.

## Preconditions before activating sign-in

- The Azure test API deployment pipeline must be healthy.
- Administrative write routes must require a verified API session; the API now
  enforces this for scanner administration and user management.
- The public static admin site must never contain a password or authorization
  decision; it only holds a short-lived opaque session token after sign-in.
- Goodwill must provide its Entra tenant and decide the initial Organization
  Owners.
