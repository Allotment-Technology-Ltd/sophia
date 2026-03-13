---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Build Pack 02: First Extraction Backlog by File and Module

## Purpose

This backlog defines the first practical extraction sequence from the current SOPHIA repository into Restormel platform packages. It is based on the current code layout and is designed to minimize disruption.

The first wave should focus on:

1. shared contracts
2. graph projection and graph utilities
3. observability and streaming primitives
4. retrieval and GraphRAG internals

## Extraction Strategy

Work in **waves**, not a single refactor.

### Wave 1
Contracts and zero/low-behaviour modules.

### Wave 2
Graph and trace utilities used by both SOPHIA and Restormel Graph.

### Wave 3
Retrieval and GraphRAG logic.

### Wave 4
Reasoning runtime.

### Wave 5
Providers and BYOK.

### Wave 6
Ingestion and enrichment.

## Wave 1: `@restormel/contracts`

### Goal
Create a stable package for shared types and schemas used across products, services, and SDKs.

### Move first
- `src/lib/types/api.ts`
- `src/lib/types/constitution.ts`
- `src/lib/types/domains.ts`
- `src/lib/types/enrichment.ts`
- `src/lib/types/learn.ts`
- `src/lib/types/passes.ts`
- `src/lib/types/providers.ts`
- `src/lib/types/references.ts`
- `src/lib/types/verification.ts`
- `src/lib/server/ingestion/contracts.ts`
- selected shared server types from `src/lib/server/types.ts`

### Notes
- convert implicit local-only types into explicit exported contracts
- add zod validators where missing
- define schema versioning early

### Dependencies to manage
- imports currently pointing into app-local paths
- overlap between server-only and shared runtime types

### Deliverables
- `@restormel/contracts`
- index exports grouped by domain
- no behaviour changes yet

## Wave 2: `@restormel/graph-core` and `@restormel/observability`

### Goal
Extract the graph representation layer and the trace formatting layer so Restormel Graph can be built independently of SOPHIA.

### Move into `@restormel/graph-core`
- `src/lib/server/graphProjection.ts`
- `src/lib/utils/graphLayout.ts`
- `src/lib/utils/graphTrace.ts`

### Candidate follow-ons
- graph-specific logic currently embedded in panel or store layers
- graph summary helpers from the UI stores once identified

### Move into `@restormel/observability`
- `src/lib/utils/sseHandler.ts`
- event-shaping logic from analyse/verify routes
- trace/replay helpers currently spread across stores or route handlers

### Notes
- extract a `ReasoningEvent` contract first
- define `GraphSnapshot` and `RunTrace` explicitly
- avoid coupling layout code to a specific renderer at this stage

### Deliverables
- `projectGraph()`
- `diffGraphs()`
- `summarizeGraph()`
- `traceToEvents()`
- `eventsToTrace()`

## Wave 3: `@restormel/graphrag-core`

### Goal
Extract the technically differentiated retrieval layer.

### Move first
- `src/lib/server/retrieval.ts`
- `src/lib/server/hybridCandidateGeneration.ts`
- `src/lib/server/seedSetConstructor.ts`
- `src/lib/server/domainClassifier.ts`

### Likely adjacent dependencies
- `src/lib/server/sourceIdentity.ts`
- `src/lib/server/embeddings.ts`
- `src/lib/server/db.ts`
- `src/lib/server/db-pool.ts`
- parts of `src/lib/server/enrichment/gates.ts`

### Notes
- split domain classification from retrieval where possible
- introduce storage/provider interfaces rather than direct DB calls
- ensure retrieval trace is a first-class output

### Deliverables
- `retrieve()`
- `retrieveWithTrace()`
- `buildSeedSet()`
- `expandGraph()`
- `buildContextPack()`

## Wave 4: `@restormel/reasoning-core`

### Goal
Extract the reasoning runtime and pass orchestration.

### Move first
- `src/lib/server/engine.ts`
- `src/lib/server/reasoningEngine.ts`
- `src/lib/server/contextPacks.ts`
- `src/lib/server/reasoningEval.ts`

### Move prompt layer next
- `src/lib/server/prompts/analysis.ts`
- `src/lib/server/prompts/critique.ts`
- `src/lib/server/prompts/synthesis.ts`
- `src/lib/server/prompts/reasoning-analysis.ts`
- `src/lib/server/prompts/reasoning-critique.ts`
- `src/lib/server/prompts/reasoning-synthesis.ts`
- `src/lib/server/prompts/reasoning-eval.ts`
- `src/lib/server/prompts/constitution-eval.ts`

### Hold for later if needed
- `src/lib/server/constitution/evaluator.ts`
- `src/lib/server/constitution/rules.ts`

### Notes
- separate runtime orchestration from SOPHIA-specific framing
- isolate prompt templates from product copy
- standardize pass outputs under `@restormel/contracts`

### Deliverables
- `runReasoning()`
- `runReasoningBatch()`
- `buildContextPacks()`
- `parsePassOutput()`

## Wave 5: `@restormel/providers`

### Goal
Extract provider routing and BYOK into a platform package.

### Move first
- `src/lib/server/byok/config.ts`
- `src/lib/server/byok/crypto.ts`
- `src/lib/server/byok/store.ts`
- `src/lib/server/byok/tenantIdentity.ts`
- `src/lib/server/byok/validation.ts`
- `src/lib/server/anthropic.ts`
- `src/lib/server/claude.ts`
- `src/lib/server/gemini.ts`
- `src/lib/server/vertex.ts`

### Notes
- keep billing and entitlement logic in SOPHIA initially
- make provider adapters implement a shared interface
- define provider capability metadata centrally

### Deliverables
- `resolveProvider()`
- `validateCredential()`
- `getAvailableModels()`
- `runModel()`

## Wave 6: `@restormel/ingestion-core`

### Goal
Extract ingestion, extraction, and enrichment.

### Move first
- `src/lib/server/extraction.ts`
- `src/lib/server/ingestion/claimTyping.ts`
- `src/lib/server/ingestion/passageSegmentation.ts`
- `src/lib/server/enrichment/pipeline.ts`
- `src/lib/server/enrichment/sourceExtractor.ts`
- `src/lib/server/enrichment/calibration.ts`
- `src/lib/server/enrichment/gates.ts`

### Move related scripts later
- `scripts/ingest.ts`
- `scripts/ingest-batch.ts`
- `scripts/ingest-nightly-links.ts`
- `scripts/run-ingestion-safe.ts`
- other operational ingestion scripts

### Notes
- this wave is operationally risky and should come after visible platform wins
- prefer extracting pure functions before cron and worker workflows

## UI and App Modules: Keep in SOPHIA initially

These should not be extracted in the first waves.

### Keep in `apps/sophia`
- `src/lib/components/*`
- `src/lib/stores/*`
- learn flows
- billing
- legal
- admin and history views
- route handlers specific to SOPHIA UX

### Potential later move to `@restormel/ui`
- generic visualization components
- graph canvas wrappers
- pass cards
- status badges
- model selectors where product-agnostic

## Backlog Board Structure

### Epic A: Contracts
- normalize type ownership
- remove circular dependencies
- add runtime validation
- publish first package

### Epic B: Graph and trace
- separate graph data from view state
- extract trace/event pipeline
- build Restormel Graph against package outputs

### Epic C: GraphRAG
- abstract storage and embeddings
- extract retrieval trace contract
- expose local and hosted interfaces

### Epic D: Reasoning runtime
- extract pass engine
- standardize pass events
- create hosted API shape

### Epic E: Providers
- unify provider adapters
- externalize BYOK config
- separate billing entitlements

## Recommended First Sprint Sequence

### Sprint 1
- scaffold monorepo
- create `@restormel/contracts`
- move shared types
- fix imports

### Sprint 2
- create `@restormel/graph-core`
- move graph projection and graph trace helpers
- create minimal package tests

### Sprint 3
- create `@restormel/observability`
- standardize run event format
- feed package outputs into a small local Restormel prototype

### Sprint 4
- create `@restormel/graphrag-core`
- move retrieval and seed construction
- expose retrieval trace output

## Extraction Readiness Checklist

Before moving a module, confirm:

- responsibility is clear
- package boundary is named
- imports are mostly internal to that responsibility
- product-specific copy is not mixed into the module
- tests exist or can be added immediately

## Summary

The first extraction backlog should prioritize **contracts, graph projection, trace handling, and GraphRAG**, because those create the fastest route to a visible Restormel product while also reducing coupling inside SOPHIA.
