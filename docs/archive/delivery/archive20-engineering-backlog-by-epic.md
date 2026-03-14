---
title: Restormel Platform: Engineering Backlog by Epic
owner: engineering
product: restormel
doc_type: engineering_backlog
last_reviewed: 2026-03-13
sync_to_linear: true
---

# Restormel Platform: Engineering Backlog by Epic

## Epic: 1 - Monorepo Foundation
- workspace tooling
- shared build config
- CI for apps and packages
- package release/versioning approach

## Epic: 2 - Canonical Contracts and Schemas
- graph node/edge/document schema extraction
- reasoning event schema extraction
- retrieval trace schema extraction
- zod validation and fixtures
- refactor SOPHIA endpoints to package contracts

## Epic: 3 - Graph Core Extraction
- extract graph projection
- graph stats helpers
- path-finding helpers
- graph diff helpers
- graph filters/query helpers
- refactor SOPHIA graph consumers

## Epic: 4 - Observability and Trace System
- extract SSE event shaping
- trace builder abstraction
- graph snapshot events
- replay serialization/hydration
- trace persistence interface
- sample traces

## Epic: 5 - Restormel Graph MVP
- graph canvas
- trace timeline
- inspector
- filters
- path highlighting
- graph import
- trace import
- sample demos
- invalid payload handling

## Epic: 6 - GraphRAG Core Extraction
- hybrid candidate generation
- lexical + dense orchestration
- seed balancing
- graph expansion
- context-pack builder
- retrieval trace generation
- representative tests
- SDK examples

## Epic: 7 - Hosted GraphRAG
- project and dataset model
- ingest endpoint
- retrieve endpoint
- API keys
- usage metering
- run history
- console pages
- “open in Restormel”

## Epic: 8 - Reasoning Core Extraction
- pass runner abstraction
- analysis/critique/synthesis orchestration
- continuation handling
- structured parsing
- batch and stream modes
- provider-agnostic interface
- fixtures and examples

## Epic: 9 - Hosted Reasoning API
- hosted reasoning endpoint
- graph/context-pack inputs
- batch mode
- streaming mode
- rate limits
- SDK helpers
- GraphRAG -> Reasoning examples
- console run inspection

## Epic: 10 - Providers / BYOK
- provider registry
- credential validation
- project-level provider settings
- model catalog
- fallback logic
- BYOK credential storage
- starter kits
- safety and quota limits

## Epic: 11 - Restormel Site / Docs / Playground
- homepage
- product pages
- docs IA
- playground
- example gallery
- pricing
- console routing
- changelog/blog
- analytics

## Epic: 12 - SOPHIA Migration
- replace app-local contracts
- replace graph projection
- replace event shaping
- replace retrieval runtime
- replace reasoning orchestration
- replace provider logic
- remove duplicate code

## Epic: 13 - Billing, Metering, and Packaging
- product plan model
- usage metering
- billing dashboards
- plan gating
- OSS vs paid licensing strategy
- usage alerts
- reporting

## Epic: 14 - Marketplace Readiness
- first marketplace SKU selection
- entitlement flow
- security and architecture docs
- support SLAs
- billing/fulfillment alignment
- listing page variants

## Suggested Waves
Wave 1: Epics 1–4
Wave 2: Epics 5 and 11
Wave 3: Epics 6 and 7
Wave 4: Epics 8–10
Wave 5: Epics 12–14

## Delivery Rule
Each epic should include:
- engineering stories
- DX stories
- docs
- instrumentation
- a demo outcome
