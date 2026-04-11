# Restormel Graph Kit v1 — First Slice Plan

## Phase 1 implementation sequence

1. Audit the current SOPHIA graph stack and document extraction constraints.
2. Introduce `src/lib/graph-kit/` with package-oriented types, adapters, state helpers, and workspace components.
3. Reuse the existing SOPHIA SVG graph canvas through a small compatibility refactor instead of a rewrite.
4. Add a canonical full-page graph workspace route in SOPHIA.
5. Feed the new workspace from current `graphStore` data plus a SOPHIA adapter.
6. Expose:
   - top control bar
   - graph canvas
   - persistent right inspector
   - bottom trace panel
7. Mark next-step seams for playback, provenance drawer, compare mode, and dense-graph handling.

## Scope for this pass

Included:

- extraction-friendly interfaces
- SOPHIA adapter
- basic search/filter controls
- node inspector
- retrieval-trace timeline
- route-level dogfooding screen

Deferred:

- playback scrubber and state replay
- structured provenance drawer
- side-by-side compare workspace
- dense-graph clustering / LOD strategies
- replacement of the legacy canvas renderer

## Acceptance for this pass

- A developer can open the workspace in SOPHIA.
- The workspace renders current graph data without breaking `/map`.
- Selecting a node updates a persistent right-side inspector.
- The bottom panel shows the beginnings of a reasoning trace/timeline.
- The new code is organized so the surrounding workspace can be extracted later with limited SOPHIA-specific code left behind.
