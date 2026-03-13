---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Package Boundary Specification

## Purpose
Define the first-pass package boundaries for the Restormel platform, based on the current SOPHIA codebase, so extraction can happen incrementally without a destabilising rewrite.

## Boundary principle
**Extract stable contracts first, then reusable runtime modules, then product-facing surfaces.**

The goal is not to create perfect package purity on day one. The goal is to create boundaries that:
- reduce coupling,
- allow shared ownership,
- make SOPHIA a downstream consumer,
- support Restormel as a standalone platform.

---

## Monorepo target structure

```text
/apps
  /sophia
  /restormel-site
  /restormel-console
  /restormel-playground
  /reasoning-api
/packages
  /contracts
  /graph-core
  /graphrag-core
  /reasoning-core
  /providers
  /observability
  /ingestion-core
  /sdk
  /ui
/tooling
  /config
  /scripts
  /ci
```

---

## Package 1: `@restormel/contracts`

### Role
The canonical shared language for the ecosystem.

### Responsibilities
- Own all public TypeScript types and schema validators.
- Define graph, trace, retrieval, reasoning, and provider contracts.
- Version the canonical JSON payload shapes used across apps and APIs.
- Provide zod validation and migration helpers where possible.

### Must not own
- Retrieval logic
- Reasoning logic
- Graph transformation logic
- Provider execution
- UI rendering

### Key exports
- `GraphNode`
- `GraphEdge`
- `GraphDocument`
- `ReasoningEvent`
- `ReasoningTrace`
- `RetrievalTrace`
- `ContextPack`
- `ProviderConfig`
- `ProjectConfig`
- `zGraphDocument`
- `zReasoningTrace`
- `zRetrievalTrace`

### Extraction source areas
- `src/lib/types/*`
- request and response typing from current API routes
- SSE event typing patterns
- ingestion contracts
- graph payload types used in frontend stores and server handlers

### Boundary test
If another package needs to know the shape of data, it should import from `@restormel/contracts`.

---

## Package 2: `@restormel/graph-core`

### Role
Pure graph modelling, transformation, and traversal utilities.

### Responsibilities
- Build and project graph documents from reasoning and retrieval outputs.
- Provide graph filtering, traversal, centrality, path extraction, and diffing helpers.
- Serialize and normalize graph payloads.
- Offer adapter interfaces for external graph input formats.

### Must not own
- LLM invocation
- Retrieval ranking logic
- Prompt orchestration
- UI-specific layout rendering
- Authentication or persistence concerns

### Key exports
- `projectGraph()`
- `normalizeGraph()`
- `filterGraph()`
- `findPaths()`
- `diffGraphs()`
- `summarizeGraph()`
- `toGraphDocument()`
- `fromNeo4j()`
- `fromNetworkX()`
- `fromSophiaTrace()`

### Extraction source areas
- current graph projection logic
- graph trace utilities
- graph layout preparation utilities that are not UI-framework-specific
- any source-to-node and relation-to-edge transforms

### Boundary test
If a function can run with plain data and no model call, it probably belongs here.

---

## Package 3: `@restormel/graphrag-core`

### Role
Graph-native retrieval and context-pack generation.

### Responsibilities
- Candidate generation
- Dense plus lexical retrieval orchestration
- Seed balancing and selection
- Relation-aware graph expansion
- Context-pack assembly
- Retrieval trace capture

### Must not own
- Final reasoning pass orchestration
- UI concerns
- Provider key storage
- Tenant billing

### Key exports
- `retrieve()`
- `retrieveWithTrace()`
- `buildSeedSet()`
- `expandGraph()`
- `buildContextPack()`
- `rerankCandidates()`
- `classifyDomain()`

### Extraction source areas
- retrieval pipeline
- hybrid candidate generation
- seed set construction
- domain routing or classifier helpers
- graph closure / support / objection expansion logic

### Boundary test
If the job is “assemble the best evidence and graph neighbourhood for a query,” it belongs here.

---

## Package 4: `@restormel/reasoning-core`

### Role
Structured multi-pass reasoning runtime.

### Responsibilities
- Orchestrate analysis, critique, synthesis, and optional verification passes.
- Parse structured outputs into canonical contracts.
- Handle pass lifecycles, retries, and continuation logic.
- Emit reasoning events in a streaming-safe format.
- Support provider-agnostic execution through injected adapters.

### Must not own
- Provider credential storage
- UI state
- Product pricing logic
- Marketplace entitlements

### Key exports
- `runReasoning()`
- `runReasoningBatch()`
- `buildPassPlan()`
- `parsePassOutput()`
- `buildReasoningTrace()`
- `runVerification()`

### Extraction source areas
- reasoning engine orchestration
- context pack consumption logic
- pass prompt builders
- reasoning evaluation helpers
- structured parsing and pass result shaping

### Boundary test
If the job is “turn context into structured multi-pass reasoning,” it belongs here.

---

## Package 5: `@restormel/providers`

### Role
Provider abstraction and BYOK-compatible model execution layer.

### Responsibilities
- Register providers and models.
- Validate credentials.
- Standardize model invocation.
- Expose capability metadata.
- Support fallback chains and model gating.

### Must not own
- Billing and entitlements in v1
- Reasoning prompt logic
- UI and console rendering
- Marketplace-specific subscription logic

### Key exports
- `resolveProvider()`
- `validateCredential()`
- `getAvailableModels()`
- `runModel()`
- `ProviderRegistry`

### Extraction source areas
- existing provider adapters
- BYOK handlers
- model selection helpers
- provider capability mapping

### Boundary test
If the module only exists because different model vendors behave differently, it belongs here.

---

## Package 6: `@restormel/observability`

### Role
Trace capture, event shaping, run diagnostics, and replay utilities.

### Responsibilities
- Build canonical traces from retrieval and reasoning runs.
- Aggregate and replay events.
- Store graph snapshots and compute diffs.
- Expose metrics-oriented hooks.
- Support Restormel visualisation surfaces.

### Must not own
- Graph traversal logic itself
- Retrieval ranking itself
- Core reasoning orchestration
- Frontend rendering

### Key exports
- `createTrace()`
- `appendEvent()`
- `finalizeTrace()`
- `extractGraphSnapshots()`
- `traceToReplay()`
- `summarizeRun()`

### Extraction source areas
- SSE event shaping
- replay helpers
- graph snapshot logic
- runtime telemetry structures
- trace formatting utilities

### Boundary test
If it helps explain what happened in a run, it belongs here.

---

## Package 7: `@restormel/ingestion-core`

### Role
Source ingestion, extraction, enrichment, and graph population.

### Responsibilities
- Parse source material.
- Segment and normalize content.
- Extract claims and relations.
- Validate ingestion quality.
- Persist or emit ingest outputs for graph-building.

### Must not own
- Product UI
- Authentication
- Graph rendering
- Live reasoning runtime

### Key exports
- `ingestSource()`
- `extractClaims()`
- `extractRelations()`
- `validateIngestion()`
- `buildIngestionGraph()`

### Extraction source areas
- ingestion scripts
- extraction and enrichment flows
- source staging and promotion helpers

### Boundary test
If the process starts from documents and ends with structured graph-ready material, it belongs here.

---

## Package 8: `@restormel/sdk`

### Role
Developer-facing integration layer.

### Responsibilities
- Provide easy-to-adopt client helpers.
- Support embedding graph and trace visualisation.
- Expose adapters from common ecosystems.
- Abstract low-level contracts for normal app builders.

### Must not own
- Core retrieval logic
- Core reasoning logic
- Internal console-specific UI

### Key exports
- `createRestormelClient()`
- `renderGraph()`
- `renderTrace()`
- `uploadTrace()`
- `openVisualizer()`
- `fromLangChainTrace()`
- `fromLlamaIndexTrace()`
- `fromCustomGraph()`

### Boundary test
If a third-party developer touches it directly, it probably belongs here.

---

## Package 9: `@restormel/ui`

### Role
Reusable UI primitives and product-level components.

### Responsibilities
- Graph canvas
- node inspector
- timeline view
- pipeline view
- filters and legends
- empty and loading states
- docs-ready example components

### Must not own
- Business logic for retrieval or reasoning
- Provider execution
- Product pricing and auth

### Key exports
- `GraphCanvas`
- `NodeInspector`
- `TraceTimeline`
- `PipelineView`
- `SnapshotDiffView`
- `Legend`
- `RunSummaryCard`

### Boundary test
If it renders data already prepared by another package, it belongs here.

---

## App responsibilities

### `apps/sophia`
- Public reference application
- Product storytelling and dogfooding surface
- Consumer/prosumer-facing flows
- Uses shared packages; owns minimal custom logic

### `apps/restormel-site`
- Marketing site
- docs shell
- static product pages
- changelog and blog

### `apps/restormel-playground`
- Anonymous or light-auth trial surface
- upload graph / upload trace
- open visualiser
- quickstart links into console

### `apps/restormel-console`
- authenticated self-serve control plane
- API keys
- projects
- providers
- saved traces
- usage and billing

### `apps/reasoning-api`
- hosted product surface for reasoning and GraphRAG endpoints
- API docs and live testing support

---

## Dependency rules

### Allowed dependency direction
- apps can depend on any package
- `ui` can depend on `contracts`, `graph-core`, `observability`
- `sdk` can depend on `contracts`, `graph-core`, `observability`
- `reasoning-core` can depend on `contracts`, `providers`, `observability`
- `graphrag-core` can depend on `contracts`, `graph-core`, `observability`
- `graph-core` can depend only on `contracts`
- `contracts` depends on nothing platform-specific

### Forbidden directions
- `contracts` must not import from any other internal package
- `graph-core` must not import from `reasoning-core`
- `providers` must not import from `ui`
- `graphrag-core` must not import from app code
- apps must not recreate contracts locally

---

## Extraction order

### Phase 1
`@restormel/contracts`

### Phase 2
`@restormel/graph-core`
`@restormel/observability`

### Phase 3
`@restormel/graphrag-core`

### Phase 4
`@restormel/reasoning-core`
`@restormel/providers`

### Phase 5
`@restormel/sdk`
`@restormel/ui`

### Phase 6
`@restormel/ingestion-core`

---

## Success criteria
- SOPHIA can consume shared packages without regressions.
- Restormel Graph MVP can be built without copying SOPHIA internals.
- Canonical schemas are versioned and validated in one place.
- Retrieval and reasoning traces are product-agnostic.
- New products can be added without adding bespoke core logic to SOPHIA.
