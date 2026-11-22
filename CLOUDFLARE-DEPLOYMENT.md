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
2. Ensure the Worker secret `NAVSTAR_SETUP_KEY` exists. Never place its value in GitHub or browser code.

## Verify deployment

After a successful deployment, open:

- `/api/health` — confirms the Worker can query D1.
- `/api/setup-status` — reports whether the schema/bootstrap is ready.
- `/setup-database.html` — protected one-time schema installer.

A successful health response is `{"ok":true,"service":"NAVSTAR ERP API","database":"connected"}`.

## Important

The school directory and dashboards remain interface prototypes until their data operations are connected to authenticated, tenant-scoped server APIs. Do not enter real student or confidential school data until authentication, authorization, audit logging, backups, and tenant isolation are implemented and tested.
