# Restormel Platform Overarching Implementation Plan

## Purpose
Define the implementation plan for moving from the current SOPHIA-centric codebase to a live Restormel platform with reusable packages and a clear first product wedge.

## Strategic outcome
Build a live Restormel platform where:
- reusable platform modules exist as clear packages
- SOPHIA consumes those modules as a downstream app
- the reasoning workspace is the first public wedge product
- graph-aware evaluators and lineage exports sit on the same canonical reasoning object
- commodity infrastructure is integrated rather than rebuilt

## Delivery goals

### Goal 1
Extract the canonical reasoning object and package boundaries without breaking SOPHIA.

### Goal 2
Ship a reasoning workspace MVP that proves the debugger category.

### Goal 3
Enable compare mode, evaluator workflows, and lineage export on top of the same compiled structure.

### Goal 4
Launch a site and docs experience that explains the product clearly and supports self-serve adoption.

### Goal 5
Add hosted persistence, collaboration, and enterprise controls only after the core wedge is working.

## Workstreams

### Workstream A — Contracts and core extraction
Focus on `contracts`, `graph-core`, and `reasoning-core`.

### Workstream B — Workspace product
Build the reasoning workspace, inspectors, and compare flows.

### Workstream C — Evaluators and lineage
Add graph-aware evaluator primitives and exportable lineage outputs.

### Workstream D — Site, docs, and playground
Explain the category, support samples, and enable first-use imports.

### Workstream E — Hosted product foundations
Auth, retention, sharing, billing, and enterprise controls.

## Implementation sequence
1. Lock terminology and package map.
2. Extract contracts and graph-core.
3. Extract reasoning compilation.
4. Refactor SOPHIA to consume shared packages.
5. Build workspace MVP on imported runs.
6. Add compare mode and evaluators.
7. Add lineage exports.
8. Add hosted persistence and team features.
9. Add enterprise and marketplace readiness.

## Decision rules
- extract before rewriting
- preserve current behaviour where possible
- prefer adapters to bespoke abstractions
- do not expand ownership into crowded substrate categories
- prioritise vertical slices that prove the wedge

## Success criteria
The plan is succeeding when:
- the same reasoning object powers product, API, and export surfaces
- SOPHIA is clearly downstream
- users can import runs without adopting a whole new infra stack
- the public story is about debugging and evaluation, not generic AI plumbing
