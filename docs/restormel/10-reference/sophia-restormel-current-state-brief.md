# SOPHIA / Restormel Current State Brief

## Purpose

Use this document as the default grounding brief for future AI chats working in this repo.

It is intended to answer:

- what SOPHIA is today
- what Restormel is becoming
- what has already been extracted into shared packages
- what is still app-local
- what is real, partial, or still only planned

## One-line summary

**SOPHIA is the working reference application and proving ground; Restormel is the emerging platform layer being extracted from SOPHIA, with Restormel Graph as the first serious product wedge.**

## Repo reality

- The live app is still the root SvelteKit app.
- The repo is now workspace-aware:
  - `apps/*`
  - `packages/*`
  - `infra`
- `apps/sophia` exists only as a placeholder for future relocation.
- The main developer entrypoints are still root scripts in [package.json](/Users/adamboon/projects/sophia/package.json#L1).
- Current stack:
  - SvelteKit 2
  - Svelte 5
  - Vite 5
  - Vitest
  - Playwright
  - Firebase / Firestore
  - SurrealDB
  - AI SDK integrations

## SOPHIA current product state

### What SOPHIA is

SOPHIA is no longer just a philosophy chatbot. In code and product shape, it is a graph-grounded reasoning application with:

- retrieval and graph assembly
- multi-pass reasoning orchestration
- verification / constitution / reasoning-quality signals
- BYOK and billing scaffolding
- observability and event streaming
- graph inspection and compare surfaces

### SOPHIA strengths

Based on the current codebase and repo assessment, the strongest parts are:

- retrieval architecture
- runtime orchestration
- ingestion discipline
- BYOK / billing scaffolding
- structured streaming and observability

The best single repo-grounded summary remains:

**SOPHIA is becoming a graph-grounded reasoning infrastructure product, with philosophy as its proving ground.**

Reference: [sophia-repo-assessment.md](/Users/adamboon/projects/sophia/docs/restormel/08-sophia/sophia-repo-assessment.md#L1)

### SOPHIA current weaknesses

The main gaps are still:

- evaluation proof
- domain-routing robustness
- frontend completeness outside the Graph workspace path
- product-boundary clarity
- some shallow provenance and evidence depth

## Restormel current product state

### What Restormel is

Restormel is the platform and product-family direction being extracted from SOPHIA.

Current intent:

- SOPHIA stays the reference app / showcase app
- Restormel becomes the platform layer
- the first public wedge is Restormel Graph
- GraphRAG follows later as an upstream-producer or integration surface, not as a reinvention target

### What Restormel already has in code

Restormel is no longer only a naming direction. The repo now contains real extracted platform seams:

- shared contracts
- graph-core helpers
- observability normalization
- canonical reasoning-object model
- reasoning-state compare
- audit-ready lineage export

### What Restormel does not yet have

It is not yet a separate deployed platform product in this repo. It is still an extraction-in-progress inside the SOPHIA monorepo.

## Current package state

### Real packages

- [packages/contracts](/Users/adamboon/projects/sophia/packages/contracts/README.md#L1)
  - shared DTOs, schemas, reasoning-object contracts, trace-ingestion, compare, lineage
- [packages/graph-core](/Users/adamboon/projects/sophia/packages/graph-core/README.md#L1)
  - graph projection, graph diffs, workspace filtering/scoping, graph-native evaluation, compare diffing, lineage generation
- [packages/observability](/Users/adamboon/projects/sophia/packages/observability/README.md#L1)
  - trace/event normalization, SSE helpers, trace-to-reasoning-object conversion

### Placeholder packages

- `packages/graphrag-core`
- `packages/reasoning-core`
- `packages/providers`

These exist as package locations, but they are not yet heavily extracted.

## Canonical architecture state

### Current differentiated layer

The repo is increasingly organized around this stack:

1. upstream producers
   - retrieval
   - GraphRAG-like assembly
   - extraction
   - enrichment
   - trace/event inputs
2. canonical reasoning-object layer
3. graph compilation and evaluation layer
4. Graph Kit workspace / compare / inspector / lineage surfaces

### Canonical model now in place

The main canonical model is `ReasoningObjectSnapshot`.

It now unifies:

- graph nodes and edges
- evidence
- provenance
- trace events
- outputs
- evaluation metadata
- version / run / snapshot identity

Reference: [restormel-reasoning-object-core-note.md](/Users/adamboon/projects/sophia/docs/restormel/04-delivery/restormel-reasoning-object-core-note.md#L1)

## Graph / Graph Kit current state

### What is real

The Graph workspace is real and active inside SOPHIA:

- the old Map tab implementation has been replaced by Graph Kit
- there is also a full-page workspace route
- the workspace has:
  - top control bar
  - graph canvas
  - right inspector
  - bottom trace panel
  - compare panel
  - lineage/export panel

Main integration points:

- [MapTab.svelte](/Users/adamboon/projects/sophia/src/lib/components/panel/MapTab.svelte#L1)
- [GraphWorkspace.svelte](/Users/adamboon/projects/sophia/src/lib/graph-kit/components/GraphWorkspace.svelte#L1)
- [+/page.svelte](/Users/adamboon/projects/sophia/src/routes/map/workspace/+page.svelte#L1)

### What is partial

- renderer is still the legacy SOPHIA canvas
- playback is event-focus, not full replay
- compare is meaningful, but not yet overlaid directly on the graph
- provenance depth is still uneven because current SOPHIA graph payloads are not always rich enough
- some graph taxonomy is still inferred because SOPHIA does not emit all desired node kinds directly

Reference: [restormel-graph-kit-v1-status.md](/Users/adamboon/projects/sophia/docs/restormel/03-product/restormel-graph-kit-v1-status.md#L1)

## Compare and lineage state

### Compare mode

Compare mode is no longer just a visual scaffold. It now diffs canonical reasoning-object snapshots for:

- added / removed claims
- evidence changes
- provenance changes
- contradiction changes
- support-strength changes
- local justification-path changes
- output changes

Reference: [restormel-reasoning-compare-diff-note.md](/Users/adamboon/projects/sophia/docs/restormel/04-delivery/restormel-reasoning-compare-diff-note.md#L1)

### Audit-ready lineage

The repo can now generate a first decision-lineage artefact from the canonical reasoning model:

- reasoning summary
- evidence-backed justification summary
- contradiction summary
- provenance bundle
- compare summary if a baseline exists
- Markdown and JSON export surfaces

Reference: [restormel-audit-lineage-export-note.md](/Users/adamboon/projects/sophia/docs/restormel/04-delivery/restormel-audit-lineage-export-note.md#L1)

## Retrieval / GraphRAG framing

The current direction is explicit:

- retrieval and GraphRAG are upstream producer surfaces
- Restormel should integrate with them and inspect/evaluate their outputs
- Restormel should not become a bespoke general GraphRAG framework unless there is a very clear differentiated reason

What should stay mostly thin or adapter-based:

- model/provider integrations
- embeddings
- vector search / DB plumbing
- transport/event infrastructure

What is currently a stronger extraction candidate:

- retrieval result contracts
- retrieval trace schema
- seed-set balancing
- evidence / provenance normalization
- graph projection seams

Reference: [restormel-retrieval-graphrag-producer-note.md](/Users/adamboon/projects/sophia/docs/restormel/04-delivery/restormel-retrieval-graphrag-producer-note.md#L1)

## Trace / observability framing

Restormel is not being built as a proprietary tracing backend.

Current direction:

- ingest and normalize traces from SOPHIA and future external ecosystems
- compile them into reasoning-object events
- use them to drive Graph / compare / lineage surfaces

What is real:

- normalized trace contracts
- SOPHIA event normalization
- `RunTrace` normalization
- OpenInference-like compatibility example

What is not real yet:

- persisted graph-frame replay
- a full observability product
- a trace storage backend

Reference: [restormel-trace-ingestion-compatibility-note.md](/Users/adamboon/projects/sophia/docs/restormel/04-delivery/restormel-trace-ingestion-compatibility-note.md#L1)

## What is extracted vs still app-local

### Already extracted or package-owned

- contracts and schemas
- reasoning-object contracts
- reasoning compare contracts
- reasoning lineage contracts
- graph projection helpers
- graph filtering / scope / readability helpers
- graph-native evaluation helpers
- reasoning-state diff logic
- lineage report generation
- trace normalization helpers

### Still mostly app-local

- engine orchestration
- pass-specific context pack assembly
- provider/model routing
- DB-specific retrieval implementation
- enrichment storage / promotion mechanics
- most route/store wiring
- current graph canvas renderer

## Current major mismatches between intent and implementation

- Intended: replayable reasoning workspace
  - Current: event-focus timeline, no true frame replay
- Intended: rich native taxonomy including evidence/inference/query/conclusion nodes
  - Current: many of those are still inferred by adapters
- Intended: deep provenance answering “where did this come from?”
  - Current: improved, but still often limited by upstream payload depth
- Intended: extraction-ready renderer boundary
  - Current: workspace state and contracts are extraction-friendly, but the renderer is still legacy SOPHIA UI

## What future AI chats should assume

### Safe assumptions

- SOPHIA is the live app and should keep working.
- Restormel is being extracted incrementally inside the same monorepo.
- `@restormel/contracts`, `@restormel/graph-core`, and `@restormel/observability` are real and should be preferred where relevant.
- Graph Kit is the active Map surface in SOPHIA.
- The canonical reasoning model is `ReasoningObjectSnapshot`.
- Compare and lineage should build on canonical reasoning objects, not ad hoc UI-only structures.

### Unsafe assumptions

- Do not assume Restormel is already a separate deployed platform.
- Do not assume playback is real.
- Do not assume provenance is complete.
- Do not assume provider/model/embedding code should be platform-owned by default.
- Do not assume GraphRAG should become a bespoke Restormel framework.
- Do not assume the app has already moved into `apps/sophia`.

## How to brief another AI quickly

If you need a short handoff, use something close to this:

> SOPHIA is the working root SvelteKit app and reference product. Restormel is being extracted from it inside the same monorepo. The main real shared packages are `@restormel/contracts`, `@restormel/graph-core`, and `@restormel/observability`. The canonical model is `ReasoningObjectSnapshot`. Graph Kit is now the active Map workspace in SOPHIA and already supports inspector, trace, compare, graph-native evaluation, and audit-ready lineage export. Retrieval/GraphRAG should be treated as upstream producers, not reinvented as a new platform. Preserve SOPHIA behavior, extract before rewrite, and prefer package-owned contracts/helpers where they already exist.

## Key files to inspect first

- [package.json](/Users/adamboon/projects/sophia/package.json#L1)
- [MIGRATION-README.md](/Users/adamboon/projects/sophia/MIGRATION-README.md#L1)
- [restormel-migration-ledger.md](/Users/adamboon/projects/sophia/docs/restormel/04-delivery/restormel-migration-ledger.md#L1)
- [restormel-graph-kit-v1-status.md](/Users/adamboon/projects/sophia/docs/restormel/03-product/restormel-graph-kit-v1-status.md#L1)
- [reasoning-object.ts](/Users/adamboon/projects/sophia/packages/contracts/src/reasoning-object.ts#L1)
- [compare.ts](/Users/adamboon/projects/sophia/packages/graph-core/src/compare.ts#L1)
- [lineage.ts](/Users/adamboon/projects/sophia/packages/graph-core/src/lineage.ts#L1)
- [MapTab.svelte](/Users/adamboon/projects/sophia/src/lib/components/panel/MapTab.svelte#L1)
- [sophiaWorkspaceBuilder.ts](/Users/adamboon/projects/sophia/src/lib/graph-kit/adapters/sophiaWorkspaceBuilder.ts#L1)

## Validation commands

When changing the extracted reasoning/graph surfaces, the current default validation commands are:

- `npm run check`
- `npx vitest run packages/contracts/src/contracts.test.ts packages/graph-core/src/graph-core.test.ts`
