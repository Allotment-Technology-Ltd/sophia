---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# Argument Map Gold-Standard Plan

## Intent

Deliver an industry-leading argument map experience that makes SOPHIA's core differentiators obvious: typed graph retrieval, three-pass dialectical reasoning, and explicit confidence/verification signals.

This plan turns the existing graph infrastructure (`graph_snapshot`, `graphStore`, `GraphCanvas`) into a flagship product surface that is reliable, accessible, and demonstrably superior for reasoning analysis workflows.

## Phase 0: Product Standard and Success Criteria

1. Define the release bar:
- Users can understand in under 60 seconds what was retrieved, how reasoning evolved, and how trustworthy conclusions are.
- Accessibility and performance are mandatory launch gates.
- The map adds explanatory value beyond the current References tab.

2. Lock measurable KPIs:
- Map open rate after completed analyses.
- Median node exploration depth per session.
- Filter/path/playback interaction rate.
- Verification engagement rate from map context.
- p95 map interactivity and render latency.

## Phase 1: Core Architecture Upgrade

1. Information architecture and navigation:
- Add a first-class `Map` tab alongside `References | History | Settings`.
- Preserve existing references behavior; map is additive.
- Add URL/query-state support for shareable map state (selection + filters).

2. Graph event/data model evolution:
- Extend `graph_snapshot` with optional metadata:
  `seedNodeIds`, `traversedNodeIds`, `retrievalRank`, `relationStrength`, `passCoverage`, `confidenceBand`, `timestamps`.
- Keep existing `nodes`/`edges` payload backward-compatible.
- Add event versioning for safe future evolution.

3. Store model refactor:
- Split graph state into `rawGraph`, `derivedGraph`, `interactionState`, `renderState`.
- Add deterministic selectors for filters, path extraction, clustering, and neighborhood focus.
- Add lifecycle state machine: `idle -> loading -> ready -> degraded -> error`.

4. Rendering engine upgrade:
- Use adaptive layouts:
  - Desktop: anchored force/hybrid layout for legibility.
  - Mobile: compact hierarchical layout for touch clarity.
- Add progressive rendering and viewport culling for large graphs.
- Add zoom-based label density (compact labels at low zoom, expanded labels at high zoom).

## Phase 2: Premium Interaction Design

1. View modes:
- `Structure View`: topology of claims, sources, and relation types.
- `Reasoning Flow View`: overlays by pass (`analysis`, `critique`, `synthesis`).
- `Trust View`: confidence and verification overlays.

2. High-value interactions:
- Neighborhood highlight and pin.
- Shortest argumentative path between selected claims.
- Instant relation-type toggles.
- Deep-link sync between map node and references/pass narrative.

3. Storytelling controls:
- Timeline scrubber for retrieval and pass progression.
- Seed-vs-traversed lens to show retrieval intelligence.
- "Why this node?" panel with provenance and relation rationale.

4. Density controls:
- Beginner mode (guided, reduced complexity).
- Expert mode (full relation taxonomy and provenance detail).
- Preset filters by pass, source, domain, and confidence band.

## Phase 3: Intelligence and Explainability Layer

1. Retrieval explainability:
- Expose retrieval rank, traversal depth, and relation provenance.
- Add context sufficiency signals for sparse/degraded retrieval.

2. Reasoning-quality integration:
- Overlay six-dimension reasoning quality signals (where available).
- Add claim-level confidence/verification badges.
- Highlight contradiction and uncertainty hotspots.

3. Comparative reasoning insights:
- Show strongest analysis support chain vs strongest critique attack chain.
- Visualize synthesis outcomes: resolved tensions vs unresolved conflicts.

## Phase 4: Trust, Compliance, and Enterprise Hardening

1. Accessibility (WCAG 2.2 AA+):
- Full keyboard graph traversal.
- Screen-reader summaries + relationship announcements.
- Reduced-motion parity for all interactions.
- Non-color semantics for relation/confidence signals.

2. Reliability and resilience:
- Handle partial/out-of-order graph events gracefully.
- Clear degraded-mode UX when retrieval context is limited.
- Deterministic fallback to references-only flow with explicit messaging.

3. Security and privacy:
- Ensure analytics are anonymized and policy-compliant.
- Prevent accidental leakage of sensitive source metadata in shared states.
- Add auditable event traces for enterprise contexts.

## Phase 5: Performance, Observability, and Scale

1. Performance engineering:
- Off-main-thread layout computation where needed.
- Batched/incremental node-edge rendering.
- 50-node default cap with progressive "show more" expansion.
- Target smooth interactions for standard graph sizes.

2. Observability:
- Track client metrics: render times, interaction latency, failures.
- Correlate server/client graph pipeline diagnostics with request IDs.
- Add admin diagnostics for graph completeness and degradation rate.

3. Experimentation:
- A/B test default view mode and guided onboarding patterns.
- Measure effect on comprehension proxies and retention.
- Roll out behind feature flags with staged cohort gates.

## Interfaces and Type Changes

1. SSE contract:
- `graph_snapshot` gains optional `meta` and `version`.
- Optionally support `graph_delta` events for progressive updates on large graphs.

2. Frontend/store interfaces:
- Add panel tab type `'map'`.
- Expose graph store commands:
  `setSnapshot`, `applyFilter`, `selectNode`, `focusPath`, `setViewMode`, `resetInteraction`.

3. Compatibility:
- Existing clients that only consume `nodes`/`edges` continue to work unchanged.
- All new fields are optional and safely ignorable.

## Test and Validation Gates

1. Unit tests:
- Selector correctness (filtering, pathing, overlays).
- Event parsing compatibility across payload versions and partial streams.
- Graph state machine transitions (`ready/degraded/error`).

2. Component tests:
- Keyboard/focus/ARIA behavior.
- View mode toggling and references sync.
- Mobile vs desktop layout and interaction parity.

3. Integration/E2E tests:
- Live query emits and renders map via `graph_snapshot`.
- Node selection syncs with references and pass context.
- Verification overlay updates without map reset.
- New query resets previous map state cleanly.

4. Non-functional release gates:
- Accessibility audit pass.
- Performance budget pass on representative graph sizes.
- Error injection pass for partial/degraded graph event scenarios.

## Rollout Stages

1. Stage A: Internal dogfood with diagnostics dashboards.
2. Stage B: Feature-flagged beta cohort with instrumentation.
3. Stage C: Public launch after KPI and quality gates pass.

Launch support should include a guided walkthrough, a demo script showing retrieval-to-reasoning flow, and clear external messaging for the map as SOPHIA's reasoning-differentiation surface.

## Assumptions and Defaults

- Scope is argument map UX (not GraphQL schema explorer).
- Two-step delivery principle is retained, expanded into phased hardening for gold-standard quality.
- Design System B remains the visual baseline.
- No SurrealDB schema change is required for initial rollout; metadata enrichments can be derived in projection/pipeline layers.
- Feature flags are available for staged rollout and experimentation.
