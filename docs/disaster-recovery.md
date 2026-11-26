# Navstar D1 backup and recovery runbook

## Backup design

- The GitHub Actions workflow `.github/workflows/d1-backup-to-r2.yml` exports the remote `navstar-erp-db` D1 database daily at **02:00 UTC** (05:00 East Africa Time), or on manual workflow dispatch.
- The SQL export is uploaded to the private `navstar-erp-storage` R2 bucket under `backups/d1/`.
- The workflow downloads the object again and compares its byte count and SHA-256 digest with the local export before inserting a `verified` row into `platform_backups`.
- Super Admin can view the verified backup register and download a SQL export from the System / Backup workspace. The download endpoint checks that the R2 object exists and its byte count matches the D1 register.
- A backup is not considered successful merely because D1 export completed. The R2 upload, read-back comparison and D1 registration must all pass.

## Required GitHub Actions secrets

The repository must have these Actions secrets configured:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token must include:
- D1 read/write access for the target account and database (the workflow exports D1 and registers the verified backup row).
- R2 Object Read & Write access for the `navstar-erp-storage` bucket.

A token that can export D1 but lacks R2 Object permissions will produce a Cloudflare `403 Authentication error` at the upload step. Do not work around this by making the bucket public. Update the token's permissions in Cloudflare, replace the `CLOUDFLARE_API_TOKEN` repository secret, and rerun the backup workflow.

## Verify backup health

1. Open the repository's Actions tab and select **Navstar D1 Backup to R2**.
2. Confirm the latest run is green and that all three stages passed: export, R2 upload, and R2 read-back / D1 registration.
3. In Super Admin, open System / Backups and confirm a new record appears with status `verified`, a non-zero byte count and SHA-256.
4. Download the backup and compare its digest with the value shown in the backup register:

```bash
sha256sum navstar-d1-backup-<BACKUP_ID>.sql
```

The displayed digest is the full expected SHA-256 in D1; compare the complete value, not the shortened value shown in the table.

## Recovery procedure (manual, Super Admin / operator only)

There is deliberately no one-click production restore endpoint. Restoring a full D1 export overwrites live application state and must be a controlled operator action.

1. Announce a maintenance window and stop school/admin writes to the production application. Do not restore while users are actively editing records.
2. Export the current production database first, so the pre-restore state is preserved:

```bash
wrangler d1 export navstar-erp-db --remote --output ./pre-restore.sql --skip-confirmation
sha256sum ./pre-restore.sql
```

3. Download the selected **verified** SQL backup from the Super Admin backup register. Record its backup ID, byte count and full SHA-256.
4. Verify the downloaded file locally:

```bash
test -s ./navstar-d1-backup-<BACKUP_ID>.sql
wc -c ./navstar-d1-backup-<BACKUP_ID>.sql
sha256sum ./navstar-d1-backup-<BACKUP_ID>.sql
```

5. Confirm the byte count and digest match the verified backup register. If either differs, stop; do not import the file.
6. Confirm Wrangler is authenticated to the correct Cloudflare account and the intended production D1 database. Then import the backup:

```bash
wrangler d1 execute navstar-erp-db --remote --file ./navstar-d1-backup-<BACKUP_ID>.sql
```

7. Run the application health checks, confirm migrations/schema, sign in as Super Admin, and verify a representative sample of schools, learners, enrolments, finance and academic records before reopening writes.
8. Retain both the pre-restore export and the imported backup until the incident is closed.

## Important limitations

- The backup register records verified exports; it does not itself perform a restore.
- R2 object availability and a successful download do not prove that a restore has been tested. Schedule a separate restore drill against a non-production D1 database before treating disaster recovery as fully accepted.
- Never paste API tokens, R2 access keys, or signed object URLs into tickets or chat.
