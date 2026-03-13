---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# Graph Map Simplification and Query Auditability Plan

_Date: March 12, 2026_

## Intent

Simplify SOPHIA's map so users can quickly understand performance and trust, while preserving a research-grade audit trail for every answer.

## Current Tension

The map already surfaces rich telemetry (`retrievalTrace`, seed/traversal counts, pruning reasons, rejection layers, confidence bands), but these signals are spread across many controls and cards. Users can inspect internals, but there is no single clear answer to:

- what happened in this run
- why this route was taken
- how this differs by model/depth/perspective
- whether synthesis claims are truly traceable and verifiable

## Product and Research Outcomes

1. Product clarity: default view explains a run in under 60 seconds.
2. Auditability: every output claim and synthesis statement can be traced to graph evidence.
3. Research rigor: route differences are measurable across BYOK provider/model, depth mode, and perspective.
4. Operational insight: map doubles as a performance console, not only a visualization.

## Simplification Strategy: Three-Layer Interface

### Layer 1 (Default): Run Story

Purpose: answer "what happened" with minimal cognitive load.

Show only:

- run profile: `query_run_id`, provider/model, depth (`quick|standard|deep`), perspective/lens
- route strip: `decompose -> seed -> traverse -> prune -> compose`
- top KPIs: nodes used/rejected, edges used/rejected, seeds, hops, relation kept rate, provenance coverage
- one primary map with defaults tuned for clarity (`supports`, `contradicts`, `responds-to`)

Hide advanced internals behind explicit "Inspect route" and "Research trace" actions.

### Layer 2: Route Inspector

Purpose: answer "how the query navigated the DB" and "why this node/edge".

Add an ordered stage timeline with per-stage counters:

- Query decomposition
- Seed pool and selected seeds
- Hop-by-hop traversal
- Pruning/gating decisions
- Closure enforcement (`thesis -> objection -> reply`)

Per stage, support drilldowns:

- candidate vs kept vs rejected
- reason-code histograms
- edge prior usage and threshold at each hop
- source/domain distribution shifts

### Layer 3: Research Trace (Audit Mode)

Purpose: answer "can provenance be proven" and "can novelty be verified".

Expose:

- claim-level derivation chain (`derived_from`, edge list, source spans)
- synthesis attribution table (which claims/relations support each synthesis statement)
- machine-readable trace export (JSON/JSONL) per run
- reproducibility bundle: run profile + retrieval parameters + snapshot lineage

## Answering the Key User Questions Explicitly

### What happened behind the scenes?

Add a canonical "Run Story" card with stage-level counters and durations.

### How did the query navigate the DB?

Display hop timeline with frontier sizes, beam selections, and gating outcomes per hop.

### How did claims/arguments link to the final output?

For each final claim/synthesis statement, show linked subgraph and supporting relation chain.

### How do routes differ by BYOK/depth/perspective?

Add "Run Compare" mode with route deltas:

- seed overlap
- traversal divergence index
- pruning reason deltas
- relation mix deltas
- provenance coverage deltas
- synthesis novelty deltas

### Can an individual claim be traced and provenance proven?

Introduce provenance levels:

- `P0` unlinked
- `P1` source-linked
- `P2` path-traceable (claim-to-source chain)
- `P3` stress-tested (claim weakens/fails when key evidence is removed)

### If synthesis is novel, can it be verified?

Add novelty typing for synthesis statements:

- recombination (new combination of existing claims)
- abstraction (higher-level generalization)
- extrapolation (goes beyond retrieved graph)

Require provenance proof threshold per novelty type before presenting as "high confidence".

## Data Contract Additions (Minimal, High Value)

Extend `GraphSnapshotMeta` (or adjacent run meta payload) with:

- `run_profile`: provider/model, depth mode, perspective/lens, query class
- `route_stages[]`: ordered stage stats with counts and timings
- `hop_trace[]`: frontier size, selected claims, thresholds, kept/rejected counts
- `synthesis_trace[]`: output statement id -> supporting claim ids/edge ids
- `trace_fingerprint`: stable hash for route comparison

Keep all fields optional for backward compatibility.

## Visualization Changes (Concrete)

1. Make one default map mode (`Run Story`) and move advanced toggles into `Advanced` accordion.
2. Replace many small metric chips with grouped KPI cards:
   - Retrieval
   - Traversal
   - Pruning
   - Provenance
   - Synthesis
3. Keep ghost/rejected layers off by default; show only when user selects "Show withheld candidates".
4. Add per-node "Why included" panel with compact causal chain and provenance badge.
5. Add "Compare routes" split view for two runs of the same query.

## Research Evaluation Discipline for SOPHIA

Adopt a benchmark stack aligned to current external practice:

- BenchmarkQED-style automated evaluation harness (pairwise/reference/assertion scoring)
- ARIES-style argument-relation robustness checks (cross-domain transfer remains difficult)
- KPA-style compression quality checks (coverage vs redundancy vs prevalence)
- KILT-style provenance-aware scoring (quality and provenance both required)
- RAGChecker-style module diagnostics (retrieval vs generation failure localization)

For SOPHIA, add philosophy-native metrics:

- objection/reply coverage per major thesis
- contradiction resolution rate in synthesis
- premise trace completeness
- cross-run route stability by profile (model/depth/perspective)

## Immediate Implementation Plan

### Phase A (1-2 weeks): Reframe Existing Signals

No backend changes required:

- introduce Run Story layout using existing `snapshotMeta.retrievalTrace`
- consolidate metrics into grouped KPI cards
- gate advanced trace under explicit toggles

### Phase B (2-3 weeks): Route and Compare

- add route timeline panel
- add run-compare deltas using cached history (`query_run_id`, model, depth)
- compute route divergence from existing seeds/traversal/pruning data

### Phase C (3-4 weeks): Research Trace and Exports

- add synthesis attribution table
- add machine-readable trace export
- add provenance-level badges and research dashboard summary

## External Research Signals Incorporated

- [GraphRAG query docs](https://microsoft.github.io/graphrag/query/overview/) emphasize multiple query modes (Local, Global, DRIFT, Basic) rather than one retrieval path.
- [GraphRAG paper](https://arxiv.org/abs/2404.16130) motivates structured retrieval for global/corpus-level reasoning where naive RAG underperforms.
- [BenchmarkQED](https://www.microsoft.com/en-us/research/blog/benchmarkqed-automated-benchmarking-of-rag-systems/) formalizes automated RAG benchmarking with query classes and multi-metric evaluation.
- [ARIES](https://aclanthology.org/2024.argmining-1.1/) shows argument relation identification remains hard in cross-dataset transfer, supporting conservative confidence gating.
- [KPA research](https://aclanthology.org/2023.acl-long.52/) supports key-point compression with prevalence tracking to reduce paraphrase clutter.
- [KILT benchmark](https://aclanthology.org/2021.naacl-main.200/) highlights joint quality + provenance evaluation as a benchmark norm.
- [RAGChecker](https://arxiv.org/abs/2408.08067) supports fine-grained module-level diagnosis over end-score-only evaluation.
- [PROV-O](https://www.w3.org/TR/prov-o/) offers a standard ontology for interoperable provenance exports.
- [GraphRAG project updates](https://www.microsoft.com/en-us/research/project/graphrag/) and [VeriTrail](https://www.microsoft.com/en-us/research/blog/veritrail-unifying-trustworthy-claims-and-provenance-for-multi-step-llm-workflows/) reinforce traceability as a first-class concern in production graph-RAG systems.

## Success Metrics

Product:

- median time-to-understand-run (target: under 60s)
- map abandonment rate
- route inspector usage on ambiguous/degraded runs

Research:

- percent of synthesis statements with `P2+` provenance
- percent of runs with complete route bundle export
- route divergence explained rate across model/depth/perspective comparisons

Reliability:

- degraded run diagnosability time
- mismatch rate between displayed route and stored trace
