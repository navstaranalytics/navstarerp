# NAVSTAR ERP — Cloudflare D1 database setup

Target Worker: `navstarerp`  
D1 database: `navstar-erp-db`  
Worker binding name: `DB`

## Before running the installer

1. Open Cloudflare Dashboard → Workers & Pages → `navstarerp` → Settings → Bindings.
2. Add a D1 database binding named exactly `DB` and select `navstar-erp-db`.
3. Confirm the Worker secret `NAVSTAR_SETUP_KEY` exists. Do not share its value or commit it to GitHub.
4. Deploy the current `main` branch.

## Install the schema

Open the deployed Worker URL followed by `/setup-database.html`. Enter the existing setup key privately in the page and run the installer once. The installer executes the idempotent schema statements against the D1 binding.

Do not paste SQL into the D1 console for this setup flow. Do not send the setup key to anyone.

## Verify

Open `/api/health`. Expected response:

```json
{"ok":true,"service":"NAVSTAR ERP API","database":"connected"}
```

Then open `/api/setup-status`. It should return `ok: true` after the schema is installed.

## Important security notes

- This migration creates the database structure and starter roles only. It does not create a Super Admin login.
- Never store plaintext passwords. Password hashing and session creation must be implemented in server-side handlers.
- Every school-owned API query must enforce the authenticated user's school membership and permissions on the server.
- The current school directory and dashboards are interface prototypes. Do not enter real student, staff, parent, financial, or confidential school data until server-side authentication, tenant isolation, audit logging, secure file storage, and backups are implemented and tested.

## New platform features — migration 0005

After migrations 0002, 0003 and 0004 have been applied, apply `migrations/0005_samples_automation_payments.sql` to the same remote D1 database. It adds:

- Safe tracking of school demonstration records so School Administrators can remove them without deleting real school records.
- Scheduled automation execution and notification history.
- M-Pesa callback event records for duplicate-safe payment processing.
- A reason marker that distinguishes subscription-triggered suspensions from manual Super Admin suspensions.

Do not run migration 0005 twice: it adds a column to the existing `schools` table. The new sample-data, payment and automation features depend on this migration.
