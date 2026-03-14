# Restormel Graph Kit v1 — Status

## Reference

- Design brief: `docs/restormel/03-product/restormel-graph-kit-v1-design-brief.md`

## Completed Work

- Introduced a Graph Kit workspace module under `src/lib/graph-kit/`.
- Defined extraction-oriented Graph Kit types for:
  - graph nodes and edges
  - metadata, provenance, and evidence
  - inspector payloads
  - trace events and playback descriptors
  - compare results
- Added SOPHIA adapter layers for:
  - current-session graph data
  - cached-run workspace reconstruction
  - compatibility with the legacy SVG canvas
- Built a canonical workspace surface with:
  - top control bar
  - graph canvas
  - right-side inspector
  - bottom trace panel
- Added semantic rendering for node and edge types, plus state styling for selection, related structure, contradictions, unresolved items, and dimming.
- Added dense-graph usability controls:
  - local focus
  - neighborhood depth
  - isolate neighborhood
  - node and edge filters
- Added a first trace architecture:
  - real SOPHIA-derived events where available
  - explicit placeholder markers where playback is not yet real
- Added a first compare-mode scaffold:
  - baseline selection from cached runs
  - added/removed nodes and edges
  - confidence changes
  - contradiction-state changes
  - evidence-set diffs
- Replaced the old `MapTab` implementation with the Graph Kit workspace shell so the new approach is now the active map surface in SOPHIA.

## Current Architecture

### Core module

- `src/lib/graph-kit/types.ts`
  - canonical Graph Kit contracts
- `src/lib/graph-kit/adapters/`
  - `sophiaGraphAdapter.ts`
  - `sophiaWorkspaceBuilder.ts`
  - `legacyCanvasAdapter.ts`
- `src/lib/graph-kit/state/`
  - `query.ts`
  - `focus.ts`
  - `trace.ts`
  - `workspace.ts`
  - `compare.ts`
- `src/lib/graph-kit/components/`
  - `GraphWorkspace.svelte`
  - `GraphWorkspaceToolbar.svelte`
  - `GraphWorkspaceInspector.svelte`
  - `GraphWorkspaceTracePanel.svelte`
  - `GraphComparePanel.svelte`
  - provenance/evidence primitives

### SOPHIA integration

- `src/lib/components/panel/MapTab.svelte`
  - now wraps the Graph Kit workspace and compare panel
- `src/routes/map/workspace/+page.svelte`
  - full-page Graph Kit workspace route
- `src/routes/map/+page.svelte`
  - full-page route now presents the Graph Kit surface rather than the old map-first UX
- `src/lib/components/visualization/GraphCanvas.svelte`
  - still the active renderer, but now driven through Graph Kit state and semantic styling

## Current Limitations

- The renderer is still the legacy SOPHIA SVG canvas with orbital layout logic.
- True playback is not implemented; current trace mode is event-focus, not frame replay.
- Compare mode is panel-based and signature-driven; it does not yet produce canvas overlays or side-by-side inspector diffs.
- Current SOPHIA graph data still has a narrow native node taxonomy, so several Graph Kit node types are inferred rather than emitted directly.
- Provenance is still shallow in many cases:
  - provenance IDs exist
  - full source records and excerpt-level provenance are often missing
- Dense-graph handling is improved, but still depends mostly on focus, filtering, and dimming rather than clustering or layout strategies.

## Known Mismatches Between Design Intent And Implementation

- Design intent: graph is a reasoning workspace with replayable evolution.
  - Current implementation: strong workspace shell, but replay is scaffolded rather than real.
- Design intent: semantically rich taxonomy including query, evidence, inference, conclusion, contradiction, and synthesis.
  - Current implementation: `source` and `claim` remain the only first-class SOPHIA node types; additional taxonomy is inferred by adapters.
- Design intent: provenance and evidence should answer “where did this come from?” quickly and deeply.
  - Current implementation: inspector is much better, but evidence and provenance depth still depends on limited snapshot payloads.
- Design intent: compare mode should support reasoning-state inspection as a first-class capability.
  - Current implementation: compare contracts and panel exist, but graph-overlay and inspector-diff behavior remain TODO.
- Design intent: extraction-ready package boundaries.
  - Current implementation: boundaries are mostly in place, but the renderer and some SOPHIA navigation hooks are still coupled to current app structure.

## Next Recommended Steps

1. Replace or wrap the legacy canvas with a Graph Kit-owned renderer boundary.
2. Deepen the SOPHIA trace adapter so run history can drive real playback and scrubbing.
3. Add compare-aware graph overlays and compare-aware inspector sections.
4. Add richer provenance payloads and excerpt-level evidence drawer support.
5. Introduce better dense-graph layout strategies:
   - clustering
   - grouped source containers
   - path-focused layouts
6. Stabilize compare identities beyond text signatures if SOPHIA can emit stronger persistent IDs.
7. Extract Graph Kit package seams in this order:
   - types
   - state helpers
   - workspace UI
   - rendering contract
   - SOPHIA adapters last

## Resume Guidance

If resuming work, start from:

1. `src/lib/graph-kit/components/GraphWorkspace.svelte`
2. `src/lib/graph-kit/adapters/sophiaWorkspaceBuilder.ts`
3. `src/lib/graph-kit/state/compare.ts`
4. `src/lib/components/panel/MapTab.svelte`

These are the current orchestration points for workspace behavior, SOPHIA data shaping, compare scaffolding, and active in-app usage.
