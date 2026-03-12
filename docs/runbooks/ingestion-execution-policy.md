# Ingestion Execution Policy

Date: 2026-03-12

## Allowed Execution Modes

All ingestion runs must use one of two modes:

1. `local-then-migrate` (default)
2. `direct-prod` (exception mode)

Any ad-hoc ingestion path outside these two modes is out of policy.

## Mode 1: Local Then Migrate (Default)

Use this when cost control is the priority.

Policy guarantees:

- model calls happen against local SurrealDB only
- production receives data by DB migration (no second model run)
- migration is blocked if production already has the source unless explicitly forced
- post-migration counts are verified (claims + passages)

Command:

```bash
npx tsx --env-file=.env scripts/run-ingestion-safe.ts \
  --mode local-then-migrate \
  --source-file data/sources/<source>.txt
```

If local source is not complete and you intentionally want to execute local ingestion once:

```bash
npx tsx --env-file=.env scripts/run-ingestion-safe.ts \
  --mode local-then-migrate \
  --source-file data/sources/<source>.txt \
  --allow-local-reingest
```

## Mode 2: Direct Prod (Exception)

Use only when local pipeline is not viable for that source or urgent production cutover is required.

Risk controls enforced:

- explicit confirmation flag required
- production backup is run first by default
- duplicate source protection (unless forced)

Command:

```bash
npx tsx --env-file=.env scripts/run-ingestion-safe.ts \
  --mode direct-prod \
  --source-file data/sources/<source>.txt \
  --confirm-direct-prod
```

Optional flags:

- `--skip-backup` only for controlled rollback windows
- `--force-migrate` only to replace known-bad existing source rows

## Migration Script Update

`migrate-local-to-prod.ts` now supports deterministic targeting:

- `--canonical-hash <sha256>`
- `--source-id <source:id>`
- `--title <exact title>`

Use canonical hash where possible.

## Operational Notes

- Ensure tunnel + prod credentials are active before any prod mode run.
- Prefer frozen model profiles for reproducibility.
- Never run `direct-prod` and `local-then-migrate` in parallel for the same source.
