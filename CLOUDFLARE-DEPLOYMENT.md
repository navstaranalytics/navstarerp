# NAVSTAR ERP — Cloudflare Pages deployment

NAVSTAR ERP is being developed in this repository as a plain HTML/CSS/JavaScript frontend. Cloudflare Pages can publish the static frontend from GitHub and redeploy it when commits are pushed.

## Recommended deployment method

Use **Git integration** (not Direct Upload). Git integration keeps GitHub as the source of truth and automatically deploys new commits. Cloudflare documents that Git integration cannot later be converted to Direct Upload, so choose Git integration for this project.

## First deployment

1. Sign in to the Cloudflare dashboard.
2. Open **Workers & Pages**.
3. Choose **Create application** → **Pages** → **Connect to Git**.
4. Connect/authorize the GitHub account that owns `navstaranalytics/navstarerp`.
5. Select the `navstarerp` repository.
6. Configure the project:
   - Production branch: `main`
   - Framework preset: `None` / `No framework`
   - Build command: leave blank if Cloudflare accepts it; otherwise use `exit 0`
   - Build output directory: `.` (repository root)
7. Select **Save and Deploy**.
8. Cloudflare will provide a `*.pages.dev` address when deployment succeeds.

## Automatic updates

After the GitHub repository is connected, commits pushed to `main` trigger production deployments automatically. Preview branches can be enabled for testing changes without replacing the production site.

## Current project status

- `index.html`: NAVSTAR application landing/dashboard shell.
- `super-admin.html`: Super Admin school directory frontend prototype.
- No framework build step is currently required.
- No production database, authentication, tenant isolation, or backend API has been connected yet.

## Important production security note

The current school directory stores prototype records in the browser's local storage. This is only for interface testing. Do not enter real student, staff, parent, financial, or confidential school data. Before production use, implement server-side authentication, role/permission checks, tenant-scoped database access, audit logging, secure file storage, backups, and privacy controls.

## Useful official Cloudflare documentation

- Git integration: https://developers.cloudflare.com/pages/configuration/git-integration/
- GitHub integration: https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
- Static HTML deployment: https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
- Pages limits: https://developers.cloudflare.com/pages/platform/limits/
