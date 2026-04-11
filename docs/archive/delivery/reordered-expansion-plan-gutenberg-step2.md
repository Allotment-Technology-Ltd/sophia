---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# Reordered Expansion Plan: Gutenberg Pilot as Step 2

## Summary
- Re-sequence the program so Gutenberg pilot learning is captured early and reused across PoM Wave 2, broader domain expansion, and SEP ingestion.
- Keep full target unchanged: current 11 philosophical domains, full current SEP entries, and robust long-text ingestion.

## Implementation Changes (Fixed Order)

### 1) Step 1: Baseline Ingestion Hardening
- Finalize source identity hardening (`canonical_url_hash` as primary key across fetch/checkpoint/log/retry).
- Add strict fetch/pre-scan blockers for empty text, unknown-title outputs, invalid/NaN cost estimates, and metadata mismatches.
- Align pre-scan section sizing with live ingest settings (including book-specific limits).
- Add monitor coverage for non-`source-list-3a` waves and alerts for stuck stages, zero-relations, and repeated retries.

Related roadmap: [Unified Architecture Roadmap](./unified-architecture-roadmap.md).
### 2) Step 2: Gutenberg Pilot (Kant Groundwork)
- Run a dedicated full-pipeline pilot on Gutenberg *Groundwork* using policy-compliant acquisition paths.
- Add Gutenberg-specific parsing/normalization hardening (boilerplate stripping, metadata extraction robustness, chapter-aware segmentation).
- Produce a “long-text ingestion profile” (chunk policy, retry strategy, stage fallback rules, acceptance gates) that becomes mandatory for subsequent phases.

### 3) Step 3: PoM Wave 2 Completion Using Pilot Learnings
- Re-run remaining failed/incomplete Wave 2 sources with the long-text profile and forced-stage recovery where required.
- Close Wave 2 only when quality gates pass (orphan rate, argument coverage, spot-check accuracy, no unresolved source-identity errors).

### 4) Step 4: Full 11-Domain Rollout
- Generalize API/UI/runtime typing from `ethics | philosophy_of_mind` to full `PhilosophicalDomain` (+`auto`) across analyse request, metadata, conversation/history cache, and domain selector.
- Replace hardcoded domain/lens maps with one domain registry (labels, readiness, allowed lenses, classifier keywords).
- Execute remaining domains in waves with the same reliability/quality gates used in Step 3.

### 5) Step 5: Full Current SEP Ingestion Program
- Build SEP catalog from live contents index and ingest all current `/entries/*/` (no archives in phase 1).
- Run phased SEP ingestion (pilot batch then scaled nightly batches) with robots/terms constraints enforced by scheduler.
- Maintain weekly delta ingestion for new/revised SEP entries after initial full pass.

## Test Plan
- **Reliability tests:** identity collision prevention, empty/unknown-title blocking, pre-scan correctness, stuck/retry alerting.
- **Gutenberg pilot tests:** end-to-end success on *Groundwork*, stable relation/grouping stages, repeatable rerun behavior, quality thresholds met.
- **PoM Wave 2 tests:** forced-stage recovery, completion rate and quality gate verification.
- **Domain expansion tests:** full-domain request/type compatibility, auto/manual routing correctness by domain readiness.
- **SEP tests:** catalog dedupe correctness, compliant crawl pacing, batch ingestion integrity, delta-update correctness.

## Assumptions and Defaults
- Gutenberg pilot text remains **Kant Groundwork**.
- Full-suite scope remains the existing **11-domain** taxonomy.
- SEP scope remains **current live entries only** (archives excluded initially).
- Reordered dependency is intentional: **Step 2 outputs are required inputs for Steps 3–5**.
