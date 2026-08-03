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
| **Location Manager** | Store, Donation Xpress, or warehouse lead who can keep assigned local work moving without seeing or changing the wider network. | No | Yes, only for assigned locations |
| **Read-only reviewer** | Audit, reporting, and exception review without changes; optionally limited to assigned sites. | No | View only |
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

The pilot now stores this mapping in `admin_user_locations`. An Organization
Owner assigns one or more active location IDs when creating or editing a
Location Manager. A Read-only Reviewer may optionally receive the same scope;
leaving it empty preserves network-wide read-only access. The API applies the
scope to reference data, activity, containers, review cases, corrections,
device controls, and audit searches; the web UI is not trusted to enforce it.
Goodwill can later replace the manual assignment step with an Entra group or
HR directory mapping.

The admin console keeps a corporate Locations network view and deep-links each
site to a focused workspace (`#/locations/{locationId}`). That workspace
separates containers currently at the site from inbound and outbound handoffs,
shows local scanner freshness and versions, and limits the data returned by the
API for scoped accounts. A route can therefore pass through Donation Xpress,
multiple warehouses, and a store without being flattened into a simple
store-to-warehouse diagram.

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
  the reset requires an audit reason in the console, revokes the target's
  sessions, and forces a new private password at the next sign-in. Passwords
  are one-way PBKDF2 hashes and are never displayed to an administrator;
- Organization Owners can add a second Organization Owner (for example, the
  Goodwill Chief of IT), Operations Administrators, and Read-only Reviewers;
- StackTrack will not allow the final active Organization Owner to be disabled
  or demoted; and
- scanner moves, renames, availability changes, account changes, password
  changes, review decisions, and correction decisions all write an
  authenticated actor to `audit_log`.

The pilot password bridge does not claim to provide multi-factor
authentication. For production, Goodwill should use Entra ID with Conditional
Access/MFA for Organization Owners and administrators; the local reset flow is
already separated so that an Entra-backed step-up check can be required before
issuing a temporary password.

### Sign-in recovery and MFA decisions

The signed-out console intentionally exposes only the Goodwill operations
identity and the username/password fields. It does not reveal whether a
username exists, whether an account is disabled, or whether a password was
close to correct. Failed attempts receive the same generic response and are
rate-limited. This prevents account discovery while still giving an employee a
clear next step.

The **Can't sign in?** action accepts a short, password-free description and
records an `admin.access_issue_requested` system event in the append-only audit
trail. Organization Owners and Operations Administrators can filter the Audit
trail for **Sign-in help request** and contact the employee or correct their
account. The pilot deliberately does not promise email or SMS delivery until
Goodwill chooses an owner for that notification channel (for example, a
corporate service desk mailbox or Teams queue). A production deployment should
add that notification as a server-side integration, never from the browser.

Password recovery is intentionally two-step:

1. An Organization Owner verifies the request and issues a one-time temporary
   password with an audit reason.
2. The employee signs in and chooses a private password. The temporary value
   is hashed immediately, is never shown again, and all other active sessions
   are revoked.

Do not add a public “reset by username” endpoint. Without a verified Goodwill
identity, it would let an attacker probe accounts or take over a scanner
operator. If Goodwill wants self-service recovery, use Entra's verified email,
phone, or help-desk flow and return to StackTrack only with a verified token.

For two-factor authentication, the recommended production policy is Entra ID
with Conditional Access requiring phishing-resistant MFA (security key or
passkey where available) for Organization Owners and Operations Administrators,
and MFA for Location Managers according to Goodwill's device policy. Require a
fresh step-up before adding owners, disabling accounts, issuing password resets,
retiring locations, approving material corrections, or changing authentication
policy. The local pilot remains password-only so it is explicit about its
security boundary; it must not be treated as production authentication.

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
