---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Platform: Monetisation Strategies by Product

## Monetisation Principles
- use wedge products for adoption
- monetize hosted convenience, collaboration, scale, and governance
- keep low-level package adoption friction-light
- meter compute, storage, and trace retention
- reserve enterprise monetization for support, controls, procurement, and deployment flexibility

## 1. Restormel Graph
Role:
- visual debugger for graph and trace workflows

Best model:
- freemium + hosted team tiers

Free:
- local graph import
- local trace import
- examples
- basic inspection and filtering

Paid:
- hosted trace storage
- sharing
- project workspaces
- history
- advanced comparison/diff
- collaboration

Enterprise:
- SSO
- retention controls
- auditability
- SLA
- private deployment options

Why it monetizes:
- teams pay for persistence, sharing, and collaboration
- individuals adopt because the core inspection experience is useful

## 2. Restormel GraphRAG
Role:
- graph-native retrieval engine

Best model:
- usage-based hosted API + optional local SDK

Free / Starter:
- local SDK
- examples
- docs
- trial credits

Paid:
- ingest
- storage
- retrieval calls
- trace retention
- API keys
- project management

Enterprise:
- private networking / deployment
- contract pricing
- governance controls
- onboarding and support

Why it monetizes:
- solves an operational problem
- has natural usage dimensions

## 3. Restormel Reasoning
Role:
- structured multi-pass reasoning API

Best model:
- usage-based API with premium structured/streaming tiers

Free / Evaluation:
- playground access
- trial requests
- sample traces

Paid:
- batch mode
- streaming mode
- structured pass outputs
- reasoning traces
- configurable depth and limits

Enterprise:
- custom prompt/pipeline tuning
- SLA
- dedicated throughput
- deployment flexibility

Why it monetizes:
- customers pay for inspectable, structured reasoning rather than plain text generation

## 4. Restormel Providers / BYOK
Role:
- provider abstraction and tenant-aware AI configuration

Best model:
- developer subscription + embedded/platform tier

Free:
- basic adapters
- local examples
- starter templates

Paid:
- hosted provider settings
- project-level routing
- credential validation
- usage controls
- embed starter kits

Enterprise:
- white-label embedding
- org-level controls
- audit logs
- procurement-friendly support

Why it monetizes:
- strongest as an enabling layer bundled with hosted products

## 5. Core Packages
Includes:
- contracts
- graph-core
- graphrag-core
- reasoning-core
- observability
- sdk
- ui

Best model:
- selective open-core / source-available / permissive mix

Recommendation:
- keep `contracts` open
- keep enough SDK/UI surface open to drive adoption
- monetize higher-value hosted workflows and advanced operational features

## 6. SOPHIA
Role:
- showcase app and reference implementation

Best model:
- secondary revenue stream, not the primary commercial anchor

Possible paid features:
- prosumer subscriptions
- advanced workspaces
- premium research / education features

Strategic rule:
- SOPHIA proves the platform
- it should not swallow roadmap energy intended for platform products

## Recommended Revenue Priority
1. Hosted GraphRAG
2. Restormel Graph hosted/team features
3. Reasoning API
4. BYOK bundled tiers
5. SOPHIA premium features

## Recommended Adoption Priority
1. Restormel Graph
2. Open/shared packages
3. GraphRAG SDK/examples
4. SOPHIA showcase
5. Reasoning demos

## Packaging Model
Free:
- docs
- examples
- contracts
- basic local visualizer
- limited playground use
- hosted trial credits

Pro / Builder:
- individual hosted usage
- API keys
- saved traces
- shareable sessions
- moderate quotas

Team:
- workspaces
- collaboration
- usage controls
- higher limits
- reporting

Enterprise:
- procurement
- security docs
- SSO
- SLA
- retention controls
- marketplace availability

## Product-Level Charging Logic
Restormel Graph:
- storage
- sharing
- history
- collaboration
- advanced analysis tools

GraphRAG:
- ingest volume
- storage
- retrieval calls
- trace retention

Reasoning:
- requests
- streaming
- structured outputs
- concurrency
- premium provider/model access

BYOK:
- governance
- configuration
- multi-project management
- embed/white-label capabilities

## Bottom Line
- Restormel Graph is the wedge
- GraphRAG is the strongest early revenue engine
- Reasoning is a higher-upside premium layer
- BYOK is strongest as a bundle/enabler
- SOPHIA is the showcase, not the main monetization anchor
