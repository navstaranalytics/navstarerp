# NAVSTAR ERP — D1 database setup

Target Cloudflare Pages project: `navstarerp`  
D1 database: `navstar-erp-db`  
Pages Function binding: `DB`

## Before running

1. Confirm the Pages project's Production D1 binding is named exactly `DB` and points to `navstar-erp-db`.
2. Open Cloudflare Dashboard → Workers & Pages → D1 SQL database → `navstar-erp-db` → Console.
3. Open `migrations/0001_initial_schema.sql` in this repository.
4. Copy the complete SQL file into the D1 Console and execute it once.
5. Confirm it completes without an error.

The SQL uses `IF NOT EXISTS` and `INSERT OR IGNORE` so it can be safely re-run if the first execution completes only partially. Do not run it against a database containing unrelated production data without reviewing the schema first.

## Verify the schema

Run:

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;
```

Then run:

```sql
SELECT version, description, applied_at
FROM schema_migrations;
```

You should see the NAVSTAR tables and migration `0001_initial_schema`.

## Verify the Pages binding

After the code in `functions/api/health.js` is deployed, open:

`https://navstaranalytics.github.io/navstarerp/api/health`

Note: GitHub Pages does not execute Cloudflare Pages Functions. The API URL must be on the actual Cloudflare Pages `.pages.dev` hostname or a custom domain routed through Cloudflare Pages. If the current public site is still GitHub Pages, use the Cloudflare Pages project domain for API testing.

Expected successful response:

```json
{"ok":true,"service":"NAVSTAR ERP API","database":"connected"}
```

## Important security notes

- This migration creates the database structure only. It does not create a Super Admin login.
- Never store plaintext passwords. Password hashing and session creation must be implemented in server-side Pages Functions.
- Never put database credentials, API tokens, or password hashes in browser JavaScript.
- The first Super Admin bootstrap endpoint must be one-time only and protected against repeated public account creation.
- Every school-owned API query must enforce the authenticated user's school membership and permissions on the server.
- Use a separate D1 database for Preview/staging; do not point public Preview builds at production school data.
- The schema is a foundation. Application-level validation, tenant isolation, backups, and security testing are required before real school data is entered.
