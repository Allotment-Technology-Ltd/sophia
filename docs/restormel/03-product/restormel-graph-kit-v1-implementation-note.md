# Restormel Graph Kit v1 — Implementation Note

## Current SOPHIA graph state

SOPHIA already has a working argument-map stack, but it is still optimized as a feature-specific visualization rather than an extraction-ready reasoning workspace.

### Rendering approach today

- `src/lib/components/panel/MapTab.svelte` is the orchestration layer.
- `src/lib/components/visualization/GraphCanvas.svelte` renders the graph as a custom SVG canvas with:
  - orbital/radial layout from `src/lib/utils/graphLayout.ts`
  - local pan/zoom state
  - local node and edge selection state
  - optional rejected/ghost overlay
- `src/lib/components/visualization/NodeDetail.svelte` provides a floating detail popover, not a persistent inspector.

### Current node and edge types

Current canonical types in `src/lib/types/api.ts`:

- Nodes:
  - `source`
  - `claim`
- Edges:
  - `contains`
  - `supports`
  - `contradicts`
  - `responds-to`
  - `depends-on`
  - `defines`
  - `qualifies`
  - `assumes`
  - `resolves`

This means SOPHIA already has meaningful relation semantics, but its node taxonomy is still narrower than the Graph Kit v1 brief.

### Metadata currently available

On nodes:

- label, phase, domain, source title
- traversal depth, relevance, seed/traversed markers
- confidence band, evidence strength, novelty score
- pass origin, conflict status
- derived-from IDs
- unresolved tension ID
- provenance ID

On edges:

- type and phase origin
- evidence strength, novelty score
- pass origin, conflict status
- unresolved tension ID
- provenance ID
- relation rationale
- relation confidence
- evidence count and evidence source references

On snapshot/meta:

- seed and traversed node IDs
- relation type counts
- max hops and context sufficiency
- degraded retrieval state and reason
- retrieval timestamp
- detailed retrieval trace
- rejected nodes and rejected edges
- enrichment status is tracked separately in the graph store

### Current inspector behaviour

- The current inspector is an inline floating popover anchored near the selected node.
- It shows:
  - node type
  - phase
  - label
  - trace tags
  - limited trace metadata
  - directly connected nodes
- It does not yet act as a persistent analytical side panel.
- Edge details are also shown as a small floating overlay instead of a structured inspector view.

### Trace and timeline availability

Trace data already exists in useful depth via `GraphSnapshotMeta.retrievalTrace` and includes:

- query decomposition
- seed selection stats
- traversal parameters
- pruning summary
- closure stats
- rejected claims / relations counts

What is missing is a reusable timeline/event model and a dedicated trace panel surface.

## Gaps vs the design brief

### Architectural gaps

- `MapTab` mixes:
  - graph query/filter state
  - graph analytics summaries
  - full-page route behaviour
  - canvas wiring
  - inspector-like content
- Canvas selection is mostly local to the rendering component.
- Inspector, trace, and graph controls are not cleanly separated into package-friendly modules.

### Product/UI gaps

- No canonical workspace layout with:
  - top control bar
  - central canvas
  - persistent right inspector
  - bottom trace panel
- No reusable provenance drawer surface.
- No playback model yet.
- Compare mode exists as a map-specific concept, not a package-level workspace capability.
- Dense graph handling is still mainly filter-based; layout and aggregation strategies are not in place.

### Data-shape gaps

- Current nodes are only `source | claim`.
- The brief expects a broader reasoning taxonomy:
  - evidence
  - inference
  - query/question
  - conclusion
  - contradiction
  - synthesis
- Provenance is present mostly as IDs and rationale snippets; the workspace needs richer structured provenance payloads for future drawer/detail flows.

## Proposed Graph Kit v1 architecture

Introduce an extraction-oriented module at `src/lib/graph-kit/` with these boundaries:

- `types.ts`
  - extraction-ready interfaces for nodes, edges, inspector payloads, and trace events
- `adapters/`
  - SOPHIA-specific translation from current graph snapshots into Graph Kit data
- `state/`
  - query/filter helpers and inspector summary helpers
- `components/`
  - workspace shell
  - toolbar
  - inspector
  - trace/timeline panel
  - canvas host

The existing SOPHIA canvas can be reused short term through a compatibility layer, while the surrounding workspace architecture becomes package-shaped.

## Recommended package boundaries

The future extracted package should own:

- graph workspace shell and layout
- graph-kit types
- shared query/filter state model
- inspector UI primitives
- trace/timeline UI primitives
- rendering host contract

SOPHIA should own:

- adapters from SOPHIA graph snapshots to Graph Kit models
- SOPHIA-specific metadata formatting
- SOPHIA route wiring and navigation hooks
- any temporary bridge to legacy `GraphCanvas`

## First-pass implementation slice

This first pass should:

- keep existing `/map` behaviour intact
- add a new canonical graph workspace route for dogfooding
- adapt current SOPHIA graph data into package-shaped types
- provide a persistent right inspector
- provide a bottom trace panel with useful initial events
- leave explicit TODOs for:
  - playback
  - provenance drawer
  - compare mode
  - dense graph handling

## Current limitations blocking the full design

- Layout is deterministic only in broad structure and still uses jitter.
- Selection and rendering state are not fully externally controlled.
- The current visual language is strong enough for dogfooding, but semantic styling is still tuned for `source` and `claim` more than the broader Graph Kit taxonomy.
- Trace data is rich for retrieval but much thinner for later reasoning passes, so the first timeline will necessarily be retrieval-heavy.
