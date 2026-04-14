# Phase 2 — `pause-after-validation` sign-off (engineering record)

**Not legal advice.** This file records the **PAUSE** gate between `validation-40` and **`g0-export`**.

## Status

| Gate | Outcome |
|------|---------|
| **`validation-40`** | **Complete** — golden / cohort reingestion and validation wave (operator); Neon audits **2026-04-14** (see `docs/local/operations/phase1-to-phase2-handover.md` when present locally). |
| **`pause-after-validation`** | **Complete (2026-04-13)** — frozen **Phase 0 §3–linked** measurement baselines below; explicit OK to run **`g0-export`** (stratified JSONL + manifest in `scripts/export-phase1-training-jsonl.ts`). |

## Frozen measurement baselines (do not reinterpret without a new wave)

Authoritative narrative and SQL: `docs/local/operations/phase0-extraction-ingestion-baseline-report.md` (tracked excerpt: same path in repo; full pack may live under `docs/local/`).

| Topic | Frozen values (2026-04-14 refresh, 90d window) |
|--------|-----------------------------------------------|
| Training-acceptable cohort | **67** URLs / runs (of **188** with `stage_ms` telemetry) |
| Extraction share of E2E wall | **~25.8%** mean; **~43.1%** at **p90** of per-run fractions (**N = 67**) |
| `payload.validate` ∩ training-acceptable | **7 / 67** (narrow SQL intersection; **not** sole §3 baseline — see below) |
| G0 export (Phase 1 shape, `--no-stratified`, `--limit=5000`) | **7,754** `train.jsonl` + **723** `golden_holdout.jsonl` lines, **0** invalid skips |
| Extraction vendor mix | ~41% OpenAI `gpt-4o-mini`, ~52% Vertex Gemini family — shard / filter in `g1-shards` per mitigation §8 |

**§3 quality gates:** Numeric “no regression” thresholds for faithfulness, JSON repair pressure, remediation, etc., are **defined** in Phase 0 **§3** (table). Operational comparison batches should use **archived** per-run **`[INGEST_TIMING]`** JSON (worker logs or `ingest_runs.report_envelope.timingTelemetry`) and **admin job exports**, not the **7 / 67** intersection alone.

## Archive pointers (`[INGEST_TIMING]`)

Golden / validation job logs and **`[INGEST_TIMING]`** lines are **operator-local** (GCP Logging, admin exports, or saved job output). Store copies under a durable team path (example layout): `data/exports/ingest-timing-archive/<wave-date>/` with a one-line `README.txt` noting source and time range. **Do not commit** raw third-party article text or secrets.

## Next step

- **`g0-export`** — done (see `scripts/export-phase1-training-jsonl.ts`). **`pause-after-g0`** — [`ingestion-extraction-phase2-pause-after-g0.md`](./ingestion-extraction-phase2-pause-after-g0.md). **`g1-shards`** — use **`--g1-policy-cleared`** (Vertex/Gemini via `vertex/` + `google/`, Mistral, DeepSeek) or explicit **`--g1-allow-extraction-prefix=`**, plus optional **`--g1-shard-by-provider`**.
