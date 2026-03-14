# Restormel Graph Compilation and Rendering Boundary

## Classification
- Package-boundary hardening, not a new graph implementation.
- Incremental refactor of existing Graph Kit behavior.
- Separation of graph compilation/state from rendering and inspector UI.

## Reuse candidates
- `@restormel/graph-core/workspace`
- `@restormel/contracts/reasoning-object`
- `src/lib/graph-kit/adapters/reasoningObjectGraphAdapter.ts`
- `src/lib/graph-kit/components/*`

## Build scope
- Moved generic graph workspace operations into `@restormel/graph-core`.
- Kept Graph Kit as the reusable rendering/workspace UI layer.
- Kept SOPHIA assumptions in adapters that map raw SOPHIA events and graph payloads into reasoning objects and then Graph Kit view models.
- Preserved the existing workspace screen and interaction model.

## Why it matters to Restormel
- Restormel Graph needs a defensible split between:
  - upstream reasoning artefacts
  - graph compilation/state operations
  - workspace rendering and interaction
- That split makes extraction easier and reduces the chance that SOPHIA-specific assumptions leak into the platform surface.

## Risk of overbuilding / incumbent collision
- No fresh graph UI was introduced.
- No renderer rewrite was attempted.
- The package layer only absorbed generic graph operations already proven in the SOPHIA workspace.

## Current boundary
- `@restormel/contracts`
  - reasoning-object, graph, trace, and normalized trace-ingestion contracts
- `@restormel/graph-core`
  - graph projection
  - graph summaries/diffs/layout
  - graph workspace operations such as filtering, neighborhood scoping, path focus, and readability analysis
- Graph Kit in `src/lib/graph-kit`
  - rendering adapters
  - inspector payload building
  - timeline/selection UI
  - semantic rendering and workspace composition
- SOPHIA adapters
  - `sophiaReasoningObjectAdapter.ts`
  - `sophiaGraphAdapter.ts`
  - `sophiaWorkspaceBuilder.ts`

## What is still mixed but acceptable for now
- Inspector payload assembly still lives in Graph Kit state because it is tightly tied to the current UI contract.
- Ghost-node and ghost-edge mapping still passes through app-local adapters because the current source shape comes from SOPHIA snapshot metadata.
- The legacy SVG canvas remains the main renderer, behind Graph Kit adapters.

## Recommended next extraction step
- Move compare diffing from Graph Kit state onto reasoning-object or graph-core helpers once compare mode stops depending on Graph Kit UI signatures.
- Introduce a package-owned Graph Kit UI package only after the renderer and inspector contracts stabilize across more than one consumer.
