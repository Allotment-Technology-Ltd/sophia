# Restormel Architectural Modularisation Plan

## Purpose
Define how to extract Restormel from SOPHIA without destabilising working behaviour, while making the platform modular, reusable, and clearly differentiated.

## Architectural principle
Extract stable contracts first, then reasoning and graph core, then product surfaces, then optional hosted layers.

Do not attempt a full rewrite. Preserve working behaviour where possible and use package boundaries to reduce coupling before considering repo splits.

## Target architecture
Restormel should be organised as:
- shared contracts
- graph and reasoning core
- adapters to ingest traces, retrieval events, and evidence
- debugger and comparison surfaces
- optional hosted APIs and persistence
- SOPHIA as a downstream app

## Strategic ownership boundaries

### COMMODITY — integrate
- trace collection substrates
- generic telemetry pipelines
- provider SDKs and model routing
- vector and graph database runtime ownership
- generic RAG orchestration
- baseline eval libraries

### DIFFERENTIATED — build
- reasoning graph compilation
- canonical reasoning objects
- support / contradiction / provenance transforms
- graph-aware diagnostics
- compare and regression state transforms
- governance lineage exports
- reasoning debugger UI and view models

### ADJACENT — own thin wrappers only
- trace ingestion adapters
- evaluator runners
- import/export SDKs
- run persistence
- auth, tenancy, and billing hooks for hosted surfaces

## Recommended package groups

### `@restormel/contracts`
Canonical schemas, validators, DTOs, enums, IDs, and serialisation rules for reasoning objects, trace imports, evidence, lineage, and evaluation results.

### `@restormel/graph-core`
Graph modelling, traversal, filtering, diffing, path analysis, and projection helpers. No UI and no provider logic.

### `@restormel/reasoning-core`
Compilation of traces, retrieval flows, and evidence into reasoning objects. Claim extraction, relation synthesis, provenance binding, contradiction detection, and evaluation orchestration.

### `@restormel/evals`
Graph-aware evaluator primitives and runner interfaces. Focus on support quality, contradiction exposure, evidence sufficiency, retrieval structure, and compare mode deltas.

### `@restormel/adapters`
Importers and exporters for upstream traces, retrieval logs, evidence bundles, and third-party tooling. Keep these thin and replaceable.

### `@restormel/observability`
Inspection helpers, event streams, and internal instrumentation for Restormel’s own surfaces. This is not a generic observability platform.

### `@restormel/ui`
Reusable workspace primitives, inspectors, comparison panes, provenance views, lineage exports, and graph view models.

### `@restormel/providers`
Minimal provider abstractions only where required for Restormel-hosted workflows. Do not turn this into a broad provider platform.

## App boundaries

### `/apps/sophia`
Reference application consuming contracts, reasoning core, graph core, and selected UI packages.

### `/apps/restormel-web`
Marketing site, docs, playground, authenticated workspace entry, and console shell.

### Optional future apps
- governance export surface
- enterprise admin surface
- internal evaluation workbench

## Extraction order
1. Stabilise canonical contracts.
2. Extract graph-core utilities that are already shared in practice.
3. Extract reasoning-core compilation logic from SOPHIA internals.
4. Introduce adapters around trace and retrieval imports.
5. Move debugger UI into reusable packages.
6. Add compare mode and evaluator surfaces.
7. Layer hosted persistence and collaboration on top.

## Anti-patterns to avoid
- moving code into packages without clarifying ownership
- abstracting providers and orchestration too early
- hard-coding UI to SOPHIA-specific shapes
- building a generic telemetry or RAG product by accident
- coupling contracts to the needs of a single app
- designing future-perfect abstractions before the first wedge works

## Transitional rules
- package boundaries first, repo split later
- adapters instead of rewrites where shapes differ
- preserve working SOPHIA behaviour unless the change clearly improves extraction
- use typed view models between core data and UI surfaces
- keep hosted concerns separate from core reasoning logic

## Success criteria
The modularisation is working when:
- SOPHIA is a consumer of shared packages rather than the hidden platform
- the reasoning workspace can ingest data from more than one upstream producer
- compare mode and evaluators work over the same canonical reasoning object
- platform docs no longer imply that Restormel owns crowded substrate layers
