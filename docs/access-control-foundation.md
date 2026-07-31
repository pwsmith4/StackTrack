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
| **Location Manager (proposed)** | Store, Donation Xpress, or warehouse lead who can resolve local exceptions without seeing or changing the wider network. | No | Yes, only for assigned locations |
| **Read-only reviewer** | Audit, reporting, and exception review without changes. | No | View only |
| **StackTrack Support** | Time-limited, explicitly approved vendor troubleshooting access. | No | Only the granted scope |

There is no hidden developer super-admin. Goodwill should retain the ability to
remove the original implementer and all other users. Support access must be
created by an Organization Owner, expire automatically, and be written to the
audit log.

### Location-manager operating boundary

The location role is worth adding for rollout, but it should be a scoped role,
not a weaker copy of an Operations Administrator. A manager should be able to

- see containers, scanners, activity, and open exceptions for assigned
  locations;
- disable a scanner that is lost or unsafe and re-enable it after verification;
- record a local explanation and request a correction when a scan was missed,
  a container arrived without a receipt, or a scanner was used at the wrong
  location; and
- view the outcome of requests they submitted.

The manager should not be able to approve their own correction, edit another
location, add administrators, change global policy, or erase observations. A
local change should create a pending, corporate-visible request containing the
location, scanner/container, reason, before state, proposed state, and the
original evidence IDs. An Organization Owner (or a separately designated
corporate approver) decides material changes; the API must enforce the scope
server-side rather than trusting a hidden UI control.

To activate this role, Goodwill needs to provide the Entra group or HR source
that identifies a manager and the authoritative mapping from a user to one or
more location IDs. Until that mapping exists, the console presents this as a
design-ready governance model and keeps live writes limited to the existing
corporate roles.

Until a scoped support-grant workflow is introduced, the pilot treats support
as read-only: it cannot alter scanners, users, or review decisions.

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
- an Organization Owner can reset another active administrator's password;
  that action revokes the target's sessions and forces a new private password
  at the next sign-in;
- Organization Owners can add a second Organization Owner (for example, the
  Goodwill Chief of IT), Operations Administrators, and Read-only Reviewers;
- StackTrack will not allow the final active Organization Owner to be disabled
  or demoted; and
- scanner moves, renames, availability changes, account changes, password
  changes, review decisions, and correction decisions all write an
  authenticated actor to `audit_log`.

## Governed correction policy implemented for the pilot

StackTrack never edits or deletes a scanner observation. An Operations
Administrator or Organization Owner can request a correction to a container's
official location and/or loaded state, with a required evidence-based reason.
Only an Organization Owner can approve or reject the request.

- Material corrections require a different Organization Owner than the
  requester. This prevents one person from proposing and approving a
  consequential state change.
- Routine corrections still require Organization Owner approval in the pilot.
- Approval creates a newer administrative projection; it does not replace the
  original event or its evidence.
- A later physical scanner observation supersedes an approved administrative
  correction automatically.
- Reopening an approved request removes it from the official projection until a
  new decision is recorded.
- The correction register can be downloaded from Reports & data.

Goodwill can change the routine-approval policy after it defines store and
corporate authority, but material dual control should remain.

## Activity versus audit trail

These views intentionally answer different questions:

- **Activity** is the operational feed: what a scanner observed, where it was,
  and how movement is progressing. It is useful for a shift lead asking “what
  happened today?” and for tracing a container’s evidence. It is not a record
  of who changed the system.
- **Audit trail** is the governance record: who signed in, renamed or moved a
  scanner, enabled/disabled a device, requested or decided a correction, and
  which reason and before/after values were recorded. It is useful for
  accountability, investigations, and compliance. It should remain append-only
  even when the operational projection changes.

Reports can join the two by event ID, device ID, location ID, and time window,
but neither view should replace the other.

This is still a test-pilot password bridge, not the production Entra design.

## Preconditions before activating sign-in

- The Azure test API deployment pipeline must be healthy.
- Administrative write routes must require a verified API session; the API now
  enforces this for scanner administration and user management.
- The public static admin site must never contain a password or authorization
  decision; it only holds a short-lived opaque session token after sign-in.
- Goodwill must provide its Entra tenant and decide the initial Organization
  Owners.
