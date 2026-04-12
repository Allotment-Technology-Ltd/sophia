---
status: superseded
owner: adam
source_of_truth: false
replaced_by: docs/sophia/architecture.md
last_reviewed: 2026-03-13
---

> Superseded during the 2026-03-13 documentation rationalisation. Use docs/sophia/architecture.md for the live SOPHIA architecture.

# Unified Architecture Roadmap: Ingestion Quality, Model Strategy, and Retrieval Quality

_Date: March 11, 2026_

## Executive Summary
- This is a medium-high priority ingestion and architecture hardening program, not a rollback event.
- Current graph output is usable, but deterministic ingestion defects (especially duplicate `position_in_source` drift and missing relation endpoints) can silently degrade downstream retrieval, analytics, and trust.
- Priority order is deliberate: fix deterministic data integrity first, then unify multi-provider model architecture, then add retrieval sophistication behind measurable evaluation gates.
- Model switching is included, but only promoted to default when corpus-level benchmarks show better quality/cost/speed/reliability.

## Why This Roadmap Now
- Residual graph-quality audit on the Nicomachean source confirmed structural drift:
- 3001 claims with only 2851 unique `position_in_source` values.
- 150 duplicate claim-position instances across 85 duplicated positions.
- 1567 relations with 37 relations referencing missing claim-position endpoints (~2.4%).
- Argument linkage remains internally consistent in the audited checkpoint and DB (`part_of` edges aligned with argument refs).
- Similar but smaller duplication appears in another Gutenberg source, so this is a systemic ingestion-quality defect, not an isolated anomaly.

## Phase Plan (Delivery Roadmap)

### Phase 1: Deterministic Ingestion Integrity Gates (Week 1)
- Enforce unique, monotonic `position_in_source` in extraction normalization before Stage 2 (relations).
- Add hard ingest fail gates for:
- duplicate claim positions,
- relation endpoints referencing missing claim positions,
- empty/unknown title metadata,
- invalid or non-finite cost estimates,
- metadata mismatches (URL/source type/hash).
- Make `canonical_url_hash` the primary key across fetch, checkpoint, retry, and ingestion logs.
- Re-run Nicomachean and Utilitarianism from Stage 1 after patch.
- Deliverable: deterministic structural correctness with explicit error reasons.

### Phase 2: Reliability and Monitoring Control Plane (Week 2)
- Extend monitor coverage to non-`source-list-3a` waves and all-wave scans.
- Add alerting for:
- stuck stage duration thresholds,
- zero-relations/zero-arguments anomalies,
- repeated retry loops.
- Add structured stage telemetry in ingestion logs: provider/model used, retry counts, parse-repair attempts, stage timings, and cost totals.
- Add replay/remediation tooling keyed by `canonical_url_hash` for targeted recovery.
- Deliverable: faster triage and safer scale-up with quality SLO visibility.

### Phase 3: BYOK Provider Unification in Ingestion (Weeks 3-4)
- Refactor ingestion Stage 1-3 routing from `vertex | anthropic` branching to shared BYOK provider abstraction.
- Introduce stage-specific model profiles with ordered fallback chains:
- extraction,
- relations,
- grouping,
- validation,
- embeddings.
- Decouple JSON repair model from primary extraction model to improve schema-repair reliability.
- Add per-stage budget guardrails (token/cost/time/retry caps).
- Deliverable: provider-agnostic ingestion with resilient failover and explicit configuration.

### Phase 4: Retrieval Engine v2 and Graph Capability Upgrades (Weeks 5-6)
- Implement Dialectical Retrieval v2 with:
- MMR diversification before traversal,
- beam traversal with simple edge priors,
- closure enforcement (`thesis -> objection -> reply`),
- edge confidence weighting,
- fixed hop-decay constant.
- Add provenance completeness to claims/edges (source span, offsets, bibliographic identity, ingest version).
- Add SurrealDB batch neighbor fetching and strict edge-type constraints.
- Add traversal trace logging for explainability and debugging.
- Deliverable: more interpretable, higher-coverage retrieval with traceable reasoning paths.

### Phase 5: Evaluation Harness and Controlled Rollout (Weeks 7-8)
- Run 2x2 ablation harness:
- graph vs no-graph,
- single-pass vs three-pass.
- Evaluate outputs with human rubric scoring (clarity, depth, coherence, balance, citation faithfulness).
- Gate production defaults on quality gain plus bounded latency/cost regression.
- Roll out in canary waves by source type/domain before global promotion.
- Deliverable: evidence-based architecture and model changes with reversible rollout.

## Model Switch Strategy by Stage

### Guiding Rule
- No model becomes default without passing SOPHIA replay and quality gates.

### Initial Stage Recommendations
| Stage | Primary | Fallback 1 | Fallback 2 | Rationale |
|---|---|---|---|---|
| Extraction | `gpt-4.1-mini` | `gemini-2.5-flash-lite` | `claude-sonnet-4.5` | Strong quality/cost balance for structured extraction. |
| Relations | `gemini-2.5-flash-lite` | `mistral-small-latest` | `deepseek-chat` | High-volume stage favors speed and cost efficiency. |
| Grouping | `gpt-4.1` | `claude-sonnet-4.5` | `gemini-2.5-pro` | Quality-sensitive synthesis stage. |
| Validation (optional) | `claude-sonnet-4.5` | `gemini-2.5-pro` | `gpt-4.1` | Cross-model judge signal quality. |
| Embeddings | `text-embedding-005` (hold default initially) | `gemini-embedding-001` (shadow) | `voyage-3.5` / `voyage-3.5-lite` (shadow) | Promote only if retrieval quality or latency/cost materially improves. |

### Promotion Gates for Model Changes
- Quality: improved retrieval faithfulness and answer quality on fixed benchmark set.
- Reliability: lower or equal failure/retry rates under batch ingest load.
- Speed: p95 stage latency within agreed bounds.
- Cost: within configured per-stage and per-source budget ceilings.

## Recommendations Matrix (Adopt / Partial / Defer / Skip)
| Area | Recommendation | Value / Risk | Decision | Notes |
|---|---|---|---|---|
| Hybrid RAG + Knowledge Graph | Use KG for structure, retrieval for nuance | High value | Adopt | Aligns with argument-graph product intent. |
| Typed Argument Graph | Keep explicit relation semantics | Core strength | Adopt | Add stricter schema and provenance guarantees. |
| Beam Traversal with Edge Priors | Prior-guided graph walk | Medium complexity | Partial | Start simple before heavy tuning. |
| Role-Aware Priors | Proponent/Sceptic/Synthesiser presets | Good but overfit risk | Experimental | Keep config-driven, not hardcoded defaults. |
| Closure Rules | Enforce thesis-objection-reply retrieval | High value | Adopt | Central for dialectical pedagogy and map UX. |
| 2x2 Ablation Tests | Compare graph/no-graph and pass depth | High diagnostic value | Adopt | Required before wider complexity rollout. |
| Adaptive Domain Priors | Dynamic domain tuning | Early instability risk | Defer | Revisit after baseline eval corpus matures. |
| SurrealDB Batch Neighbor Fetching | Reduce traversal query overhead | Strong performance gain | Adopt | Low-risk, immediate runtime benefit. |
| MMR + Beam Diversification | Improve conceptual coverage | Practical quality gain | Adopt | Cheap and effective retrieval uplift. |
| Edge Confidence Weighting | Calibrate traversal by trust/confidence | Smart, moderate complexity | Adopt | Use simple weighting first. |
| Domain Quota Targets | Fixed numerical source/claim quotas | Low evidence value | Skip | Prefer quality and coverage metrics over quotas. |
| Adaptive Hop Decay | Per-hop score decay | Useful, simple | Adopt (fixed) | Keep constant initially; tune later. |
| Effect-Size Performance Metrics | Track quality change magnitude | Important | Adopt | Include human and rubric metrics. |

## Immediate Actions (Highest ROI)
- Patch extraction normalization for unique, monotonic positions.
- Add hard integrity gates for duplicate positions and missing relation endpoints.
- Re-ingest Nicomachean and Utilitarianism from Stage 1 post-patch.
- Add provenance fields on nodes/edges and traversal trace logging.
- Implement SurrealDB batch neighbor fetch.
- Build 2x2 ablation harness for retrieval architecture evaluation.

## Medium-Term Actions
- Add role-aware traversal presets with full logging and no default lock-in.
- Introduce confidence recalibration jobs for edge weighting.
- Build graph-vector bidirectional sync with provenance tags.
- Advance map visualization for argumentative subgraph transparency.

## Not Recommended Yet
- Adaptive domain-specific priors as default behavior.
- Rigid source/claim quota targets per domain.
- Overly large relation taxonomies (keep relation set compact and interpretable).
- Overengineered model-of-experts customization before benchmark evidence.

## Acceptance Criteria and KPIs

### Ingestion Structural Integrity
- Duplicate claim positions per source: `0`.
- Relations with missing claim endpoints: `0`.
- Missing argument claim refs: `0`.
- Hash identity mismatches across fetch/checkpoint/log/retry: `0`.

### Reliability and Operations
- Retry loop incidents reduced below target threshold.
- Stuck-stage alerts detected within defined SLA windows.
- Pre-scan and ingest gate failures produce explicit failure reasons and actionable logs.

### Retrieval Quality
- Positive quality delta in ablation tests for coherence, depth, and faithfulness.
- Stable or improved citation/provenance traceability.
- Controlled latency growth within p95 target budget.

### Cost Governance
- Per-stage and per-source cost budgets consistently enforced.
- Model-switch candidates only promoted when quality benefit justifies cost.

## Overarching Architectural Principle
- Keep retrieval and graph behavior interpretable first.
- Increase sophistication only when evaluation proves real value.
- Preserve pedagogical transparency as a non-negotiable product constraint.

## Relationship to Existing Plans
- This roadmap is the umbrella architecture and model strategy plan.
- The Gutenberg Step 2 reordered expansion plan remains the immediate execution backbone for near-term ingestion sequencing.
