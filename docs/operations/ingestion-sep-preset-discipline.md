# SEP ingestion preset discipline (quality & comparability)

Use this with [ingestion-golden-sep-corpus.md](./ingestion-golden-sep-corpus.md) and [ingestion-per-stage-model-matrix.md](./ingestion-per-stage-model-matrix.md) so **Stanford Encyclopedia** (and similar) runs stay **comparable** and **regressions are visible** when extraction strictness, passage boundaries, or validation windows change.

## Goals

- **Comparable faithfulness** — same effective knobs across benchmark runs (passage token limits, validation excerpt caps, relation batching, pins).
- **Traceable profiles** — named benchmark bundles for CI and operator waves.
- **Post-store triage** — low `validation_score` claims can flow to the **human review queue** and existing **quarantine** surfaces.

## Environment

| Variable | Purpose |
|----------|---------|
| `INGEST_PRESET_DISCIPLINE` | `off` (default) — no extra checks. `warn` — log `[INGEST_PRESET_FINGERPRINT]` JSON for `sep_entry` sources. `strict` — same log **and** require `INGEST_PRESET_PROFILE`. |
| `INGEST_PRESET_PROFILE` | Short label (e.g. `sep-benchmark-2026-04`) required when `strict`. Record it in run reports / spreadsheets when comparing waves. |
| `INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION` | Passage / extraction chunk size (defaults apply if unset; changing this changes boundaries — include in fingerprint). |
| `INGEST_PREFILTER_ENABLED` | Boilerplate prefilter (`false` changes extraction input). |
| `VALIDATION_BATCH_*` / `RELATIONS_BATCH_*` | Validation excerpt and relation chunking (see `scripts/ingest.ts` defaults). |
| `INGEST_VALIDATION_MODE` / `INGEST_VALIDATION_SAMPLE_RATE` | Validation coverage for the run. |
| `INGEST_PIN_*` / `INGEST_NO_MODEL_FALLBACK` | Model comparability ([ingestion-golden-sep-corpus.md](./ingestion-golden-sep-corpus.md)). |

The fingerprint line includes a **16-hex digest** of the bundled knobs so two runs with identical settings produce identical digests.

## Post-store audit (low faithfulness → review queue)

After Stage 6, claims can be forced to **`review_state: needs_review`** when cross-model validation produced a **faithfulness score** below a threshold. This complements `loadQuarantineClaimQueue` ([`src/lib/server/ingestion/quarantineQueue.ts`](../../src/lib/server/ingestion/quarantineQueue.ts)) and **Admin → quarantine** (`GET /api/admin/quarantine/queue`).

| Variable | Purpose |
|----------|---------|
| `INGEST_POST_STORE_LOW_VALIDATION_REVIEW_THRESHOLD` | 0–100. If set, claims with `faithfulness_score` **strictly below** this value may be marked `needs_review` (only when validation ran and the claim has a score). |
| `INGEST_POST_STORE_LOW_VALIDATION_SAMPLE_RATE` | 0–1 (default `1`). Deterministic per-claim sampling so large sources do not flood the queue; stable for the same source slug + `position_in_source`. |
| `INGEST_POST_STORE_FLAG_VERIFICATION_LOW_VALIDATION` | When `1`, also set `verification_state: flagged` for those audit hits (optional; default off). |

**Sampled re-validation** (second pass with full validation on a subset) remains an **operator workflow**: re-run ingestion with `INGEST_VALIDATION_MODE=sampled` or a durable job focused on URLs that failed thresholds — see [ingestion-sep-bulk-preset.md](./ingestion-sep-bulk-preset.md).

## Related

- [ingestion-sep-bulk-preset.md](./ingestion-sep-bulk-preset.md) — throughput and bulk defaults.
- [ingestion-benchmarks.md](./ingestion-benchmarks.md) — regression procedure when changing prompts or models.
- [ingestion-preset-evidence.md](./ingestion-preset-evidence.md) — analytics and issue signals.
