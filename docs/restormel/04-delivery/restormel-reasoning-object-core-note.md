# Restormel Reasoning-Object Core

## Classification
- Platform seam, not app UI.
- Additive extraction hardening, not a rewrite.
- Canonical contract layer between raw SOPHIA graph/runtime artefacts and downstream Graph Kit surfaces.

## Reuse candidates
- `@restormel/contracts/reasoning-object`
- `src/lib/graph-kit/adapters/sophiaReasoningObjectAdapter.ts`
- `src/lib/graph-kit/adapters/reasoningObjectGraphAdapter.ts`

## Build scope
- Added a canonical reasoning-object snapshot model with stable node, edge, provenance, evidence, trace, output, evaluation, and version metadata.
- Mapped current SOPHIA graph snapshots into that model behind a SOPHIA-only adapter.
- Rewired the Graph Kit workspace adapter to consume the canonical reasoning-object snapshot instead of inferring taxonomy and provenance directly from raw SOPHIA graph payloads.
- Preserved existing Graph Kit UI types and behavior so the change is incremental and reversible.

## Why it matters to Restormel
- Restormel Graph needs a product-level object model that is richer than transport-level graph nodes and edges.
- Compare mode, inspector depth, audit/export, and evaluation all need the same stable reasoning identity surface.
- This creates a clearer package boundary for future extraction into `@restormel/reasoning-core` without forcing a risky move now.

## Risk of overbuilding / incumbent collision
- The current model stays close to what SOPHIA already emits. It does not introduce speculative orchestration, generic tracing infrastructure, or new storage assumptions.
- Evidence, inference, query, and conclusion remain first-class kinds in the contract, but the SOPHIA adapter marks them as missing when the source data cannot support them yet.
- Compare mode is still Graph Kit-owned today; the new contract only prepares stable compare keys and version identity for the later move.

## Model summary
- `ReasoningObjectSnapshot` is the canonical envelope.
- `version` carries schema version, run identity, snapshot lineage, and source.
- `graph` carries canonical reasoning nodes and edges plus explicit missing-data notes.
- `trace` carries normalized event summaries usable by timeline, audit, and export surfaces.
- `outputs` carries synthesized/final outputs derived from the reasoning run.
- `evaluation` carries reasoning-quality and constitution-ready summary data when available.

## Mapping from current SOPHIA structures
- `GraphNode` and `GraphEdge` still arrive from SOPHIA transport contracts in `@restormel/contracts/api`.
- `sophiaReasoningObjectAdapter` classifies those raw nodes into target reasoning kinds, derives provenance and evidence items, and stamps compare-ready keys.
- `GraphSnapshotMeta` supplies snapshot lineage, retrieval trace details, and most currently available run-history context.
- `traceContext` supplies the app-local enrichments that are not always embedded in the snapshot: query text, final output, reasoning-quality results, and constitution deltas.

## What remains app-specific
- Ghost nodes and ghost edges remain Graph Kit / SOPHIA workspace concerns for now.
- Summary cards, inspector presentation, timeline playback hints, and compare UI are still downstream view-model concerns.
- Any behavior that depends on conversation-store caching or route-specific history should stay in SOPHIA until the contracts settle.

## Future extraction candidates
- Move `sophiaReasoningObjectAdapter` into a package-owned SOPHIA adapter module once the mapping stabilizes and more than one consumer exists.
- Move compare signatures and diff logic to package-owned reasoning-object helpers once compare mode stops depending on Graph Kit UI shapes.
- Consider a dedicated `@restormel/reasoning-core` package only after the reasoning-object contract proves stable across graph, compare, and evaluation flows.

## Known gaps
- SOPHIA does not yet emit first-class query, evidence, inference, or conclusion nodes in most runs.
- Full provenance records are usually not present in graph snapshots; most current provenance is identifier-only.
- Timeline playback is still event-focus only because persisted per-event graph frames are not available in the workspace path.
