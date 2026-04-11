# Phase 4/5 zero-cost cutover runbook

This runbook is the execution path for:

- **Phase 4:** SurrealDB v3 + non-GCP hosting via **SurrealDB Cloud free tier**
- **Phase 5:** App + ingest worker migration off Cloud Run to **Oracle Always Free VM** (deferred; roadmap issue [#100](https://github.com/Allotment-Technology-Ltd/sophia/issues/100))

It is designed for the current constraint: keep costs near zero until early traction.

## 0) Required credentials (blockers)

Before cutover, ensure these are available:

- SurrealDB Cloud:
  - `SURREAL_URL`
  - `SURREAL_USER`
  - `SURREAL_PASS`
  - `SURREAL_NAMESPACE`
  - `SURREAL_DATABASE`
- Oracle VM:
  - Host/IP
  - SSH username
  - SSH private key available on deploy machine

## 1) Pre-cutover checks

From repo root:

```bash
pnpm test
pnpm check
pnpm exec tsc -p tsconfig.json --noEmit
```

Ensure all pass before data movement.

## 2) Backup current SurrealDB dataset

```bash
pnpm exec tsx --env-file=.env scripts/db-backup.ts
```

Keep the generated `data/backups/<timestamp>/` folder safe.

## 3) Provision SurrealDB Cloud target

Create the instance in SurrealDB Cloud (free tier), then create the target namespace/database/user.

Set target connection values in env (or temporary shell vars), then apply schema:

```bash
pnpm exec tsx --env-file=.env scripts/setup-schema.ts
```

## 4) Restore backup into SurrealDB Cloud

```bash
pnpm exec tsx --env-file=.env scripts/db-restore.ts data/backups/<timestamp>
```

When prompted, type `confirm`.

## 5) Verify SurrealDB Cloud data health

Run retrieval and health checks against the target:

```bash
pnpm exec tsx --env-file=.env scripts/test-retrieval.ts
pnpm exec tsx --env-file=.env scripts/health-check.ts
```

If retrieval quality regresses materially, stop and investigate before production cutover.

## 6) Production app cutover to SurrealDB Cloud

Update production app env to point at SurrealDB Cloud:

- `SURREAL_URL`
- `SURREAL_USER`
- `SURREAL_PASS`
- `SURREAL_NAMESPACE`
- `SURREAL_DATABASE`

Deploy and run post-deploy verification:

- `GET /api/health` returns healthy
- Admin ingest run (real) succeeds
- Stage 6 Sync to SurrealDB succeeds
- Review dashboard and claim queries work

## 7) Migrate app + worker off Cloud Run (Oracle Always Free)

On Oracle VM:

1. Install Docker + Docker Compose plugin.
2. Deploy app image or repo checkout.
3. Set production env vars (same as current Cloud Run secrets).
4. Run app service under systemd (or compose with restart policy).
5. Configure TLS via Caddy or Nginx + Let’s Encrypt.
6. Configure nightly ingest trigger via systemd timer/cron.

Cut DNS to Oracle VM only after smoke tests pass.

Status: deferred while GCP free-usage window remains active (see issue [#100](https://github.com/Allotment-Technology-Ltd/sophia/issues/100)).

## 8) Rollback

If SurrealDB Cloud cutover fails:

- Repoint `SURREAL_*` envs back to previous host
- Redeploy app
- Keep the SurrealDB Cloud dataset for forensic comparison

If Oracle hosting cutover fails:

- Re-enable traffic on Cloud Run
- Keep Oracle instance for debugging; do not delete until root cause is fixed

## 9) Capacity guardrails for SurrealDB Cloud free tier

- Track storage growth weekly
- Set alert threshold at ~80% of free allowance
- Pre-plan paid upgrade or export/archive before write lock risk

## 10) Execution notes (2026-03-29)

Phase 4 was completed with these validated outcomes:

- Active Surreal Cloud target: `main/sophia`
- Core parity matched source: `source`, `passage`, `claim`, `argument`
- Relation/log parity matched source: `supports`, `contradicts`, `depends_on`, `responds_to`, `defines`, `qualifies`, `refines`, `exemplifies`, `part_of`, `review_audit_log`, `ingestion_log`
- Accepted reset tables: `query_cache`, `link_ingestion_queue` (operational/history state, safe to repopulate)
- Runtime cutover config uses DB user/pass auth (`SURREAL_USER`, `SURREAL_PASS`) and not short-lived `SURREAL_TOKEN`

Known caveat:

- Some local scripts (`health-check.ts`, `verify-db.ts`, retrieval smoke harness) currently assume legacy SDK/auth/runtime behavior and may fail without script-specific updates even when DB connectivity is healthy.

## 11) Phase 6/7 execution notes (2026-03-29)

- Phase 6 queue delivery now runs as a durable Neon-backed ingest queue (`ingest_runs.status='queued'` claim/poll flow) when `DATABASE_URL` + `ADMIN_INGEST_RUN_REAL=1` are enabled.
- Approved `link_ingestion_queue` rows are promoted to ingest runs by the worker poller and tracked through `queued -> ingesting -> ingested/failed`.
- Phase 7 cleanup removes legacy `claude.ts` and unused `db-pool.ts`; legacy `/api` now returns explicit deprecation (`410`) and points clients to `/api/analyse`.
- New self-serve API endpoint: `POST /api/sources/submit` (auth required, URL validation, visibility handling, entitlement gating, queue insertion).
