---
title: Restormel Platform: Milestone Plan with Exit Criteria
owner: platform-delivery
product: restormel
doc_type: milestone_plan
last_reviewed: 2026-03-13
sync_to_linear: true
---

# Restormel Platform: Milestone Plan with Exit Criteria

## Purpose
Translate the platform strategy into a milestone sequence with explicit exit criteria so progress is measured by usable outcomes.

## Milestone: 0 - Foundation Locked
### Objective
Lock naming, product hierarchy, package map, schema direction, and sequencing.
### Exit Criteria
- Strategy pack approved
- `@restormel/*` namespace fixed
- Allotment / Restormel / SOPHIA roles fixed
- Core package map agreed
- Major assumptions and risks documented

## Milestone: 1 - Monorepo and Contracts Extraction
### Objective
Stand up the monorepo and extract `@restormel/contracts`.
### Exit Criteria
- Monorepo builds locally and in CI
- Shared graph, trace, and event contracts compile across frontend and backend
- App-local duplicate schemas removed from SOPHIA
- Workspace package is consumed by the app

## Milestone: 2 - Graph and Observability Core Extracted
### Objective
Extract `@restormel/graph-core` and `@restormel/observability`.
### Exit Criteria
- Graph projection logic is package-owned
- Trace capture/replay utilities are package-owned
- At least one saved SOPHIA trace can replay through shared contracts
- Graph stats or diff helpers work against canonical graph docs

## Milestone: 3 - Restormel Graph MVP in Private Beta
### Objective
Launch the first standalone Restormel product: the visual debugger.
### Exit Criteria
- User can import graph JSON and inspect it in under a minute
- User can import trace JSON and inspect answer paths
- At least five SOPHIA traces render correctly
- At least one non-SOPHIA example renders correctly
- Quickstart and sample files exist in docs

## Milestone: 4 - GraphRAG Core Extracted
### Objective
Extract `@restormel/graphrag-core` and make it usable as a local SDK.
### Exit Criteria
- Developer can ingest a small corpus and run a query locally
- Query returns graph, retrieval trace, and context pack
- Outputs can be opened directly in Restormel
- Representative examples exist and pass tests

## Milestone: 5 - Hosted GraphRAG Beta
### Objective
Ship hosted ingest and retrieve flows.
### Exit Criteria
- User can create a project and API key
- User can ingest content and run hosted retrieval
- Usage metering is active
- Pricing and docs exist
- Error handling is good enough for external beta

## Milestone: 6 - Reasoning Core and Hosted Alpha
### Objective
Extract `@restormel/reasoning-core` and expose hosted reasoning.
### Exit Criteria
- Hosted reasoning accepts prompt and optional graph/context pack
- Returns analysis, critique, synthesis, and reasoning trace
- Streaming and batch modes exist or are clearly staged
- Restormel can visualize hosted reasoning runs

## Milestone: 7 - Providers and BYOK Productized
### Objective
Stabilize `@restormel/providers` and ship project-level BYOK flows.
### Exit Criteria
- User can register provider credentials
- Project-level provider settings work
- Validation and failure states are clear
- Hosted and embedded setup docs exist

## Milestone: 8 - SOPHIA Rebuilt on Platform Modules
### Objective
Turn SOPHIA into the reference app that consumes shared modules.
### Exit Criteria
- Shared logic is package-owned
- SOPHIA-specific logic is app-owned
- Core retrieval, reasoning, graph, and provider flows come from platform packages
- SOPHIA functions as showcase, not monolith

## Milestone: 9 - Restormel Platform Public Launch
### Objective
Launch `restormel.dev` as the self-serve platform entry point.
### Exit Criteria
- Homepage, docs, playground, pricing, and console are live
- User can sign up, get a key, run GraphRAG, and visualize output
- Basic monetization is active
- Launch analytics are in place

## Milestone: 10 - Marketplace and Enterprise Readiness
### Objective
Prepare the first hosted Restormel SKU for procurement channels.
### Exit Criteria
- First marketplace-ready product selected
- Entitlement and fulfillment workflows designed
- Architecture, security, legal, and support artifacts prepared
- Enterprise landing pages and collateral exist

## Priority Order
1. Contracts
2. Graph-core + observability
3. Restormel Graph MVP
4. GraphRAG extraction
5. Hosted GraphRAG
6. Reasoning extraction
7. BYOK/providers
8. SOPHIA migration
9. Public launch
10. Marketplace readiness

## Tracking Rule
Every milestone should end with:
- a demo
- updated docs
- explicit exit review
