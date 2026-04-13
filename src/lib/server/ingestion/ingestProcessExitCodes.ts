/**
 * Exit codes from `scripts/ingest.ts` consumed by `ingestRuns` (and tests).
 *
 * `INGEST_EXIT_FORCE_STAGE_CHECKPOINT_MISSING`: `--force-stage` was set but
 * Neon/disk checkpoints cannot satisfy the implied resume point (e.g. validation
 * tail with no prior staging for this orchestration run). The parent must **not**
 * auto-retry with `ingestAutoRetry` omitting `--force-stage` — that would fall
 * back to Surreal resume and start a full extraction.
 */
export const INGEST_EXIT_FORCE_STAGE_CHECKPOINT_MISSING = 3;
