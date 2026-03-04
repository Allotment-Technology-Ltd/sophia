# STATUS — sophia

Project: sophia
Repo: Allotment-Technology-Ltd/sophia
Maintainers: <team or maintainer names and contacts>
Last updated: 2026-03-04

## Overall status
- Status: operational (development actively ongoing)
- Summary: SvelteKit + Vite application with Pulumi infra; primary focus on scheduled ingestion, monitoring, and infra stability.

## CI / CD
- CI status: [insert badge]
- Notes: CI should validate `svelte-check`, `tsc` for infra, run unit tests, and run Pulumi preview in a controlled environment (or as a gated job with secrets).

## Tests & checks
- Tools: svelte-check (type/diagnostics), Vitest (if present), custom tsx scripts (monitor/ingest)
- How to run locally:
  - Install: `pnpm install`
  - App dev: `pnpm run dev` (or `pnpm --filter <pkg> run dev` if using workspaces)
  - Static checks: `pnpm run check` and `svelte-check --tsconfig ./jsconfig.json`

## Deployments & infra
- Infra: Pulumi (infra/ directory) — preview, up, refresh, destroy via Pulumi stack
- How to deploy infra:
  1. Authenticate Pulumi/Cloud credentials locally
  2. `cd infra && pulumi preview --stack production` then `pulumi up --stack production` when ready

## TODOs
- Add CI badge and Pulumi stack status
- Add documented secrets & provisioning steps for Pulumi
- Standardise monitoring and alerting runbook

## Useful links
- README: https://github.com/Allotment-Technology-Ltd/sophia#readme
- Pulumi docs: https://www.pulumi.com/docs/
