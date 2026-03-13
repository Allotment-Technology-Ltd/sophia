---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# Argument-Native Frontier Overhaul (Deferred)

_Date: March 12, 2026_

**Status:** Deferred

## Decision

Documented for reference; no execution approved at this time.

This plan records a robust implementation direction for the Stage 4.3 frontier ideas, while explicitly deferring delivery until evidence shows the expected product gains justify the engineering and operational cost.

## Summary

This deferred plan captures a coordinated A-D overhaul:

- A. Key-Point Layer for Debate Compression
- B. Claim-First GraphRAG
- C. Dialectic Retrieval Policies
- D. BenchmarkQED-Style Evaluation Discipline

The intent was to improve retrieval quality, reduce paraphrase noise, and strengthen reasoning evaluation discipline. The current decision is to retain this as a reference architecture, not an active execution program.

## Documented A-D Plan (Not Approved for Implementation)

### A. Key-Point Layer for Debate Compression

Build a KPA-style summarisation layer over accepted claim clusters so retrieval and UI can operate on dominant positions rather than paraphrase-heavy claim lists.

Planned shape:

- Introduce a `key_point` object with stance, confidence, provenance coverage, and review state.
- Add claim-to-key-point mappings from accepted claims only.
- Assemble context packs key-point first, then expand into bounded supporting claims.
- Preserve drilldown from key point to original claims and source spans for traceability.

Expected benefits:

- Lower retrieval redundancy.
- Better stance clarity for long, high-density debates.
- Cleaner map and trace UX when claim volume is high.

### B. Claim-First GraphRAG

Apply GraphRAG patterns to SOPHIA's claim/relation substrate instead of entity/community graphs.

Planned shape:

- Add explicit query planning modes (`local`, `global`, `hybrid`) over claim neighborhoods.
- Fuse local claim traversal with global key-point/community summaries.
- Keep trusted-edge gating, provenance constraints, and confidence-aware expansion.
- Maintain backward-compatible response contracts while replacing retrieval internals.

Expected benefits:

- Better coverage for both focused and corpus-level questions.
- More structured retrieval than vector-only nearest-neighbor behavior.
- Higher interpretability of why specific claims were selected.

### C. Dialectic Retrieval Policies

Productionise policy-specific retrieval behavior for different reasoning intents:

- exegesis
- adversarial critique
- comparison
- reconciliation
- user-position challenge

Planned shape:

- Add a policy router (`auto` plus explicit policy override).
- Define per-policy profiles for seed quotas, edge priorities, hop depth, closure rules, and token budgets.
- Thread policy and planner choices through trace metadata and map diagnostics.
- Enforce runtime fallback to baseline retrieval on budget/latency breaches.

Expected benefits:

- Better alignment between user intent and retrieved evidence shape.
- Stronger objection/reply coverage where adversarial analysis is requested.
- More predictable retrieval behavior for product and QA teams.

### D. BenchmarkQED-Style Evaluation Discipline

Mirror the BenchmarkQED mindset with a SOPHIA-specific philosophy benchmark suite and lightweight promotion gates.

Planned shape:

- Create a fixed benchmark set spanning exegesis, comparison, critique, and synthesis prompts.
- Add automated retrieval and reasoning checks:
  - closure completion
  - objection/reply presence
  - contradiction handling
  - provenance/citation fidelity proxy
- Run scheduled regression checks and block promotions on threshold breaches.
- Add small periodic human spot checks to catch false positives from automated metrics.

Expected benefits:

- Faster regression detection.
- More disciplined rollout decisions.
- Better long-term quality governance for retrieval/policy changes.

## Why Deferred Now

The current decision is to defer implementation because projected effort and risk are not proportionate to near-term product return.

Key reasons:

- High integration cost across schema, retrieval planner, trace payloads, and UI.
- Elevated operational risk in public-default rollout of multiple coupled changes.
- Significant evaluation and observability overhead required to manage regressions safely.
- Marginal user-facing gain is uncertain relative to already-available retrieval improvements.
- Opportunity cost is high versus current priorities (stability, throughput, and focused quality uplifts).

## Revisit Triggers

Re-activate this plan only if one or more conditions are met:

- Repeated evidence that current retrieval quality plateaus on priority user tasks.
- Clear benchmark deltas showing a lightweight version of A-D materially improves answer quality without violating latency/cost constraints.
- Product demand for policy-selectable retrieval behavior becomes persistent and measurable.
- Team capacity allows a dedicated architecture stream without displacing core roadmap commitments.
- Observability and rollback controls are sufficient for safe staged rollout.

## Defaults and Guardrails When Revisited

- Treat this document as the canonical frontier reference until superseded.
- Re-entry should begin with a thin, flaggable slice before broad rollout.
- Do not implement functionality from this document without explicit re-approval.
