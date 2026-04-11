# Future: async vendor batch lane (design spike)

Sophia’s production ingest path is **interactive and resumable**: `scripts/ingest.ts` drives stages with checkpoints, Restormel/AAIF routing, and Neon staging. That does **not** map cleanly onto vendor **async batch inference** products (e.g. OpenAI Batch API, similar file-based flows on other providers), which are typically:

- **Submit** a large JSONL job, **wait** hours (often up to ~24h), **download** results.
- **No** mid-run operator hooks, per-URL progress in the admin UI, or the same retry/resume semantics as today’s `ingest_runs`.

## Recommended direction

Treat an async batch lane as a **separate product surface**, not a drop-in replacement for `callStageModel` / `generateText` inside `ingest.ts`:

1. **Ingest** (or export) canonical URLs and minimal metadata into a **staging table** or object store.
2. A **worker** submits batch jobs to the provider, polls until complete, stores raw outputs keyed by URL.
3. A **reduced import path** merges outputs into Surreal/Neon (validation, dedupe, store) with its own idempotency keys.

## When it is worth it

- Very large **homogeneous** workloads where **latency of hours** is acceptable and **cost discount** from batch pricing matters.
- **Not** a substitute for durable job ticks, DLQ, or watchdogs on the main pipeline.

## Constraints

- New LLM execution must still respect Sophia server rules (routing through established gateways, no ad-hoc provider keys in clients).
- Coordinate with Restormel Keys for any **new** workload/stage naming if batch outputs are re-fed through AAIF.

This document is intentionally **design-only**; implementation is deferred until the main durable job + DLQ path is stable in production.
