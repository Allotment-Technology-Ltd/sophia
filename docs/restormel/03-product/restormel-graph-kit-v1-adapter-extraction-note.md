# Restormel Graph Kit v1 — Adapter And Extraction Note

## What changed

The Graph Kit workspace now renders from a stable Graph Kit view model rather than directly from raw SOPHIA graph snapshot types.

Current layering:

- `src/lib/graph-kit/types.ts`
  - Graph Kit domain and view-model types
- `src/lib/graph-kit/adapters/sophiaGraphAdapter.ts`
  - SOPHIA-specific classification and transformation logic
- `src/lib/graph-kit/adapters/legacyCanvasAdapter.ts`
  - temporary compatibility adapter into the existing SOPHIA `GraphCanvas`

## Current SOPHIA taxonomy coverage

Mapped with confidence:

- `source`
  - direct mapping from SOPHIA `source` nodes
- `claim`
  - direct mapping from SOPHIA `claim` nodes where no stronger semantic signal exists
- `synthesis`
  - inferred from synthesis-phase claim nodes
- `contradiction`
  - inferred from contested/unresolved claim state

Not yet available as first-class SOPHIA graph nodes:

- `query`
- `evidence`
- `inference`
- `conclusion`

These are represented as modeling gaps rather than fake nodes.

## Missing data limiting full design fidelity

- graph snapshots do not currently include a first-class query/question node
- evidence is mostly attached as metadata, source titles, rationale strings, and reference IDs
- inference steps are implicit, not explicit nodes
- conclusion is not clearly separate from synthesis in current graph data
- provenance is often available only as a provenance ID, not a full provenance payload
- compare-mode inputs are not normalized into a reusable compare result yet

## Extraction path

To extract Graph Kit later:

1. move `src/lib/graph-kit/types.ts` and non-SOPHIA UI/state modules into the package
2. keep `sophiaGraphAdapter.ts` inside SOPHIA as an integration adapter
3. replace `legacyCanvasAdapter.ts` by either:
   - a Graph Kit-owned renderer, or
   - a renderer adapter contract implemented per host app

The main package seam is now explicit: Graph Kit consumes `GraphKitWorkspaceData`, while SOPHIA owns the translation from its runtime graph structures into that model.
