# Runbooks & shortcuts — sophia

## Quick commands
- Install dependencies: `pnpm install`
- Start dev server: `pnpm run dev`
- Run checks: `pnpm run check` (runs svelte-check + custom scripts if configured)

## Infra (Pulumi)
- Preview infra changes: `cd infra && pulumi preview --stack production`
- Apply changes: `cd infra && pulumi up --stack production`
- Destroy (careful): `cd infra && pulumi destroy --stack production`

## Monitoring & ingestion
- Run a single monitor job once:
  - `pnpm run monitor:wave -- --once` (or equivalent script configured)
- Resume ingestion for a wave:
  - `pnpm run ingest:wave1:retry`

## Health checks
- Health endpoint (if deployed): `curl -s --max-time 30 https://usesophia.app/api/health | jq .`
- Periodic checks should validate health endpoint and ingestion queues.
