# Administrator access setup

The pilot now has a server-side administrator directory. It is intentionally
separate from scanner identity: a scanner cannot become an administrator merely
because it knows a device or tenant ID.

## Create the first Organization Owner (Azure test only)

Run this from the StackTrack project folder. It prompts for the Azure PostgreSQL
administrator password and for the Organization Owner password; neither is saved
to the repository or command history.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\infrastructure\postgres\bootstrap-admin-owner.ps1 -ServerName "testserv5.postgres.database.azure.com" -AdminLogin "theparkersmith" -Username "root" -DisplayName "Parker Smith"
```

Use a unique password of at least 12 characters. `root/password` remains a
local-only example and must never be used in Azure.

## Pilot roles

- **Organization Owner** — manages administrators and all operational controls.
- **Operations Administrator** — manages containers, locations, scans, and
  scanners but cannot add administrators.
- **Read-only Reviewer** — reviews data and exports reports without changing
  operational records.

## What the pilot console enforces

- New users begin with a temporary password and a password-change reminder.
  Users can change their own password in **Settings**; that change invalidates
  their other browser sessions.
- An Organization Owner can rename a user, change their role, or disable their
  account in **Settings → Administrator directory**. Disabling or changing a
  role immediately revokes that person’s active sessions.
- The Devices page records the signed-in administrator whenever a scanner is
  renamed, moved, enabled, or disabled. A scanner-move reason is optional for
  this pilot, but the action itself is never silent.
- The Needs review page records every decision as an append-only action with a
  required reason. Only an Organization Owner can resolve a material case.

The initial password route is only a temporary pilot bridge. Production should
use Goodwill Microsoft Entra sign-in and map Entra object IDs to these roles.
