# NAVSTAR ERP — Cloudflare Worker deployment

The production app is deployed as a Cloudflare Worker with static assets and API routes.

## Cloudflare Workers Builds settings

- Repository: `navstaranalytics/navstarerp`
- Production branch: `main`
- Root directory: `/`
- Build command: leave blank / None
- Deploy command: `npx wrangler deploy`

The repository includes `worker.js` as a committed entry point. Do not run the Pages Functions build command and do not point Wrangler at a generated `dist/worker/index.js` file.

## Worker configuration

- Worker name: `navstarerp`
- Static assets directory: `./public`
- Static asset binding: `ASSETS`
- Worker entry point: `./worker.js`

The Worker dispatches `/api/health`, `/api/setup-status`, and `/api/setup-database` to the existing server-side handlers in `functions/api/`. All other requests are served from `public/`.

## Required bindings and secrets

In Workers & Pages → `navstarerp` → Settings:

1. Add a D1 database binding named exactly `DB` and select `navstar-erp-db`.
2. Add an R2 bucket binding named exactly `R2` and select `navstar-erp-storage`.
3. Ensure the Worker secret `NAVSTAR_SETUP_KEY` exists. Never place its value in GitHub or browser code.

## Verify deployment

After a successful deployment, open:

- `/api/health` — confirms the Worker can query D1.
- `/api/setup-status` — reports whether the schema/bootstrap is ready.
- `/setup-database.html` — protected one-time schema installer.

A successful health response is `{"ok":true,"service":"NAVSTAR ERP API","database":"connected"}`.

## Production acceptance status

- The School Admin workspace uses authenticated, school-scoped D1 APIs; persistent school data is not stored in browser localStorage.
- Learner passport photos, branding assets and the School Documents & Files register use R2, with D1 metadata and upload verification.
- Curriculum visibility preserves Super Admin-enabled CBE and 8-4-4 configurations.
- Automated D1 backup export is implemented. The latest recorded backup run successfully exported the remote D1 database but its R2 object upload failed with HTTP 403 Forbidden. The GitHub `CLOUDFLARE_API_TOKEN` therefore still needs R2 object read/write permission for `navstar-erp-storage`; rerun the backup workflow after correcting the token and require upload, read-back checksum verification and D1 backup-register confirmation before marking backups healthy.
- The authenticated Super Admin live R2 upload/read/delete health check is implemented. It must be run and confirmed in the deployed Super Admin workspace.
- A controlled non-production restore drill and full school-role/tenant end-to-end acceptance remain outstanding.

Do not mark the platform launch-ready until the R2 backup has been verified, a restore drill has succeeded, and school-admin, teacher, learner and parent workflows have passed end-to-end tests.

## Scheduled automation

The repository's `wrangler.jsonc` configures a daily Worker cron at 06:00 UTC (09:00 East Africa Time). The Super Admin must activate the desired tasks under **Terminology & Access Rules → Scheduled automations**. The first run occurs after the updated Worker is deployed and migration 0005 is applied.

## M-Pesa Daraja secrets

For online Navstar subscription payments, add these Worker variables/secrets in Cloudflare. Never commit their values:

- `MPESA_CONSUMER_KEY` (secret)
- `MPESA_CONSUMER_SECRET` (secret)
- `MPESA_SHORTCODE`
- `MPESA_PASSKEY` (secret)
- `MPESA_CALLBACK_TOKEN` (secret; use a long random value)
- `MPESA_ENVIRONMENT` (`sandbox` for testing, then `production`; this is the exact Worker variable read by the Daraja integration)
- Optional: `MPESA_TRANSACTION_TYPE`

See `MPESA-INTEGRATION.md` for the Daraja callback and sandbox test procedure. Online payment confirmation is not accepted as production-ready until these values are configured, the provider status reports all required credentials present, and a sandbox STK callback has been verified end-to-end. The latest GitHub deployment did not run the manual M-Pesa secret-sync step; verify the existing Worker secrets in Cloudflare before testing.


## Automated D1 backups

The repository includes a scheduled GitHub Actions workflow at `.github/workflows/d1-backup-to-r2.yml`:

- Runs daily at 02:00 UTC and can also be started manually from GitHub Actions.
- Exports the remote `navstar-erp-db` schema and data using Wrangler D1 export.
- Uploads the SQL export to the `navstar-erp-storage` R2 bucket under `backups/d1/`.
- Downloads the uploaded object again and verifies its byte count and SHA-256 checksum before recording a verified backup row in D1.
- Requires the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` GitHub Actions secrets. The API token must permit remote D1 export/execute and R2 object read/write.

Super Admins can review verified backup metadata and download SQL archives from **Backup & Recovery → Automated D1 backups**. The in-app page does not perform a one-click restore. Restore must be performed by an authorized operator during a controlled maintenance window after verifying the archive and target database. No automatic retention deletion is configured; configure an R2 lifecycle policy only after agreeing the required retention period.
