---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Architectural Modularisation Plan

## Status
Draft v1 for platform extraction from the current SOPHIA codebase.

## Goal
Transform the current SOPHIA application from a monolithic product into a modular platform architecture where reusable infrastructure is extracted into Restormel packages and SOPHIA becomes a downstream consumer.

## Guiding architecture principle
**Package boundaries first, repo split later.**

The first step should be a package-structured monorepo, not multiple repos. The current code appears tightly coupled enough that an early multi-repo split would create unnecessary friction.

## Target monorepo structure

```text
/allotment-platform
  /apps
    /sophia
    /restormel-site
    /restormel-console
    /api
    /docs
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
  /infra
  /scripts
```

## Package naming
Use the Restormel namespace for all public packages.

- `@restormel/contracts`
- `@restormel/graph-core`
- `@restormel/graphrag-core`
- `@restormel/reasoning-core`
- `@restormel/providers`
- `@restormel/observability`
- `@restormel/sdk`
- `@restormel/ui`

Potential internal-only packages:
- `@restormel/ingestion-core`

## Canonical platform contracts
These should be defined first and versioned carefully.

### 1. Graph contract
Defines the shared graph document format used by:
- Restormel Graph
- GraphRAG
- Reasoning traces
- SOPHIA visualisation
- import/export adapters

Recommended fields:
- node id
- node kind
- label
- summary
- metadata
- source refs
- scores
- edge source
- edge target
- edge kind
- direction
- weight
- confidence
- provenance

### 2. Reasoning event contract
Defines the event stream format for:
- SSE
- API responses
- replay
- observability
- UI rendering

Event examples:
- run_start
- pass_start
- pass_chunk
- pass_complete
- claims
- relations
- graph_snapshot
- metadata
- error

### 3. Retrieval trace contract
Defines the trace structure for GraphRAG and retrieval inspection.

Trace should capture:
- candidate generation
- lexical hits
- embedding hits
- reranking
- seed selection
- graph expansion
- pruning decisions
- context-pack assembly

## Package responsibilities

### `@restormel/contracts`
Purpose:
- shared types
- schemas
- zod validators
- event contracts
- DTOs for all other packages

Owns:
- graph schema
- reasoning trace schema
- retrieval trace schema
- provider config contracts
- source / claim / relation types

Extraction candidates from current code:
- `src/lib/types/*`
- ingestion contracts
- API DTOs
- pass enums
- provider types
- verification-related shared types

### `@restormel/graph-core`
Purpose:
- graph projection
- graph transforms
- graph traversal
- path and diff helpers
- graph summarisation

Owns:
- graph projection from runtime outputs
- graph filters
- path discovery
- graph statistics
- snapshot diffing

Likely extraction candidates:
- graph projection logic
- graph layout helpers
- graph trace helpers
- claim/relation normalization utilities

### `@restormel/graphrag-core`
Purpose:
- hybrid retrieval
- seed construction
- graph expansion
- relation-aware context pack generation

Owns:
- dense + lexical retrieval composition
- seed balancing
- graph closure enforcement
- traversal depth control
- pass-ready context pack shaping

Likely extraction candidates:
- retrieval pipeline
- hybrid candidate generation
- seed-set constructor
- domain classification used in routing
- reranking and expansion logic

### `@restormel/reasoning-core`
Purpose:
- reasoning orchestration runtime
- pass flow management
- structured output parsing
- prompt routing hooks

Owns:
- analysis / critique / synthesis orchestration
- continuation handling
- context pack assignment
- run metadata
- structured output normalization

Likely extraction candidates:
- reasoning engine
- engine orchestrator
- reasoning evaluation helpers
- context-pack builders
- prompt builder modules

### `@restormel/providers`
Purpose:
- provider abstraction
- model selection
- BYOK plumbing
- provider validation

Owns:
- provider registry
- available model metadata
- key validation
- provider routing
- fallback chains

Likely extraction candidates:
- BYOK modules
- provider adapters (Gemini, Anthropic, Vertex, Claude, etc.)

### `@restormel/observability`
Purpose:
- traces
- replay
- snapshot capture
- telemetry formatting

Owns:
- trace creation and finalization
- graph snapshots over time
- event-to-replay formatting
- trace adapters for UI consumption

Likely extraction candidates:
- SSE helpers
- trace formatting utilities
- graph snapshot emission logic
- replay-related utilities

### `@restormel/sdk`
Purpose:
- the developer-facing entry point
- convenience wrappers for platform usage

Should expose:
- graph render helpers
- trace adapters
- API clients
- quick setup helpers
- framework-friendly integration patterns

### `@restormel/ui`
Purpose:
- reusable UI components for visualisation and product surfaces

Should expose:
- GraphCanvas
- PipelineView
- TraceTimeline
- NodeInspector
- SnapshotDiffView
- provider config controls
- graph filters and legends

### `@restormel/ingestion-core`
Purpose:
- ingestion and graph population pipeline

This may remain internal at first.

Owns:
- source ingestion
- parsing
- claim extraction
- relation extraction
- validation
- graph population

## Public API direction

### Graph API
Shared `GraphDocument` format used everywhere.

### GraphRAG API
Suggested hosted endpoints:
- `POST /v1/ingest`
- `POST /v1/retrieve`
- `GET /v1/runs/:id`
- `GET /v1/graphs/:id`

### Reasoning API
Suggested hosted endpoints:
- `POST /v1/reason`
- `POST /v1/reason/stream`
- `GET /v1/reason/runs/:id`

### Provider / BYOK API
Suggested endpoints:
- `POST /v1/providers/validate`
- `GET /v1/providers/models`
- `POST /v1/projects/:id/provider-config`

## Extraction order

### Phase 1: contracts
Goal:
- freeze schemas
- centralize shared types

Deliverables:
- `@restormel/contracts`
- schema docs
- type ownership map

### Phase 2: graph-core + observability
Goal:
- power Restormel Graph MVP
- stabilize graph and trace handling

Deliverables:
- `@restormel/graph-core`
- `@restormel/observability`
- SOPHIA uses package imports instead of local utilities

### Phase 3: graphrag-core
Goal:
- expose retrieval intelligence as reusable platform infrastructure

Deliverables:
- `@restormel/graphrag-core`
- retrieval trace contract
- local SDK + basic hosted surface

### Phase 4: reasoning-core
Goal:
- expose structured reasoning runtime as reusable platform capability

Deliverables:
- `@restormel/reasoning-core`
- reusable pass orchestration
- run + event model

### Phase 5: providers
Goal:
- unify BYOK and provider-flexible configuration

Deliverables:
- `@restormel/providers`
- model metadata registry
- key validation

### Phase 6: ingestion-core
Goal:
- extract ingestion once platform boundaries are stable

Deliverables:
- `@restormel/ingestion-core`
- source-to-graph pipeline

## App ownership after extraction

### `apps/sophia`
Should own:
- public-facing SOPHIA experience
- billing, pricing, product messaging
- auth and user history UX
- domain-specific flows
- showcase visual integration using Restormel components

### `apps/restormel-site`
Should own:
- product marketing site
- docs discovery pages
- playground entry points
- templates and package discoverability

### `apps/restormel-console`
Should own:
- project management
- API keys
- trace history
- uploads
- billing and usage
- provider config

### `apps/api`
Should own:
- hosted GraphRAG
- Reasoning API
- auth/entitlement enforcement
- API docs generation support

## Architecture rules

### Rule 1
All cross-package communication should go through contracts.

### Rule 2
UI packages should not own business logic that belongs in core packages.

### Rule 3
Reasoning and retrieval must emit traces by default.

### Rule 4
SOPHIA can extend the platform, but should not fork core logic casually.

### Rule 5
No platform feature should depend on philosophy-specific naming or schemas at the core level.

## Near-term technical milestones
1. define graph and trace schemas
2. create contracts package
3. move graph utilities and trace shaping into packages
4. build Restormel Graph MVP against those packages
5. extract GraphRAG retrieval into a clean package boundary
6. adapt SOPHIA to consume the extracted modules

## End-state architecture goal
A developer should be able to:
- install Restormel packages
- ingest documents
- run GraphRAG retrieval
- inspect traces visually
- add structured reasoning
- configure providers
- optionally deploy or buy through marketplace channels

SOPHIA should simply be the most complete demonstration of that ecosystem.
