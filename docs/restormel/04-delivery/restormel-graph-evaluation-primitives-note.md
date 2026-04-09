# Restormel Graph-Aware Evaluation Primitives

## Classification

- Graph-native evaluation layer, not a generic observability dashboard.
- Package-owned reasoning evaluation helpers with thin workspace surfacing.
- Incremental use of current SOPHIA data rather than speculative scoring infrastructure.

## Reuse candidates

- `@restormel/contracts/reasoning-object`
- `@restormel/graph-core/evaluation`
- `src/lib/graph-kit/adapters/reasoningObjectGraphAdapter.ts`
- `src/lib/graph-kit/state/query.ts`

## Build scope

- Added graph-aware evaluation contracts to the reasoning-object model.
- Implemented the first credible graph evaluators in `@restormel/graph-core`.
- Wired findings into the reasoning-object snapshot during SOPHIA adaptation.
- Surfaced graph-evaluation summary and node-related findings through the existing workspace inspector.

## Why it matters to Restormel

- This starts differentiating Restormel on reasoning quality at the graph level, not just trace inspection or generic runtime telemetry.
- The checks operate on claims, sources, evidence links, provenance, contradiction structure, and justification paths, which is closer to the actual product wedge than generic dashboard metrics.

## Risk of overbuilding / incumbent collision

- No generic metric platform or dashboard framework was added.
- The evaluator set is intentionally narrow and only uses data the current repo can support credibly.
- Several checks are conservative because SOPHIA still lacks first-class evidence, inference, and conclusion nodes in many flows.

## Implemented evaluator slice

- unsupported claim detection
- claim without evidence detection
- contradiction presence / density
- missing provenance flags
- weak source diversity flags
- unresolved inference chain detection
- conclusion confidence gap detection
- disconnected justification path detection

## Current data limits

- Explicit evidence nodes are still mostly absent; evidence is often metadata rather than first-class graph structure.
- Provenance is frequently identifier-only instead of a fully expanded provenance record.
- Some `derivedFromIds` references point to non-materialized upstream nodes.
- Conclusion and synthesis remain partially conflated in current SOPHIA graph snapshots.

## Stronger future evaluators would need

- explicit evidence nodes and citation spans
- richer provenance records embedded in snapshots
- first-class inference and conclusion nodes
- persisted historical graph frames for change-aware evaluation over time
- canonical source identity across retrieval, graph, and evidence items