---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-26
---

# Roadmap

This roadmap is intentionally narrower than the older phase-plan set. It captures the active direction for SOPHIA as the showcase/reference app.

## Current roadmap themes

### 1. Keep SOPHIA credible as the showcase app

- maintain the end-to-end reasoning experience
- keep verification, map/explainability, API, and account flows coherent
- ensure product-facing docs describe what is actually in the repo

### 2. Separate showcase truth from platform truth

- use `docs/sophia/` for SOPHIA product truth
- use `docs/restormel/` for platform strategy and modularisation
- archive detailed historical plans rather than letting them compete with the active set

### 3. Stabilise domain growth

- treat `ethics` and `philosophy_of_mind` as the live showcase reasoning domains
- promote further domains only when ingestion, retrieval quality, and documentation are ready
- keep domain-expansion status explicit rather than implied by old plans or enum support alone

### 4. Improve evidence and explainability

- continue strengthening evaluation, auditability, and map clarity
- keep explanation surfaces grounded in what the product can currently show
- avoid documenting speculative platform claims as if they were settled SOPHIA product commitments

### 5. Support platform extraction without forking the narrative

- allow reusable infrastructure to mature in-repo
- hand platform-wide strategy, packaging, and ecosystem decisions to Restormel docs
- update SOPHIA docs when extraction materially changes app boundaries

## Future enhancements (ingestion presets)

Deferred from the ingestion preset refinement plan — implement when analytics justify the extra automation.

### Phase 4 — Stability knobs tied to presets

- Wire or document **preset → suggested concurrency / embed delay** defaults (`ADMIN_INGEST_MAX_CONCURRENT`, `VERTEX_EMBED_BATCH_DELAY_MS`, relation overlap), using classified retries and provider limit headers where available.
- Goal: reduce **429 / retry storms** without starving throughput.

### Phase 5 — Golden-set release gate

- Maintain a **small golden corpus** (e.g. one SEP, one long book, one PhilPapers-style paper) and run your ingestion benchmark procedure (see `scripts/` and internal ops notes) before promoting preset or catalog changes.
- **Ship** only when wall time and cost move as intended without a proportional rise in `json_repair`, `batch_split`, or failed stages vs the prior baseline.

## Explicitly de-emphasised

The following are no longer maintained as separate active SOPHIA source-of-truth plans:
- old root-level phase roadmaps
- overlapping BYOK and monetisation rollout plans
- parallel architecture hardening narratives
- superseded implementation packs that duplicate current-state or architecture guidance

Those materials are preserved outside this public documentation slice.
