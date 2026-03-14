# Restormel Marketplace Strategy

## Status
Rewritten v2 to align marketplace sequencing with the debugger/evaluator wedge rather than a broad GraphRAG platform story.

## Purpose
Use cloud marketplaces as procurement and enterprise distribution channels for hosted Restormel products after the self-serve motion is proven.

## Marketplace principle
Marketplace is not the first go-to-market motion. It is a multiplier on top of:
- a clear wedge product
- working self-serve onboarding
- pricing and entitlements
- security and procurement readiness
- hosted operational maturity

## Marketplace-ready SKU
The first marketplace SKU should be:

**Restormel Graph Team / Enterprise**
A hosted reasoning workspace with:
- saved runs
- compare mode
- team collaboration
- retention and sharing
- graph-aware evaluators
- lineage and audit exports
- SSO / enterprise controls at higher tiers

This is more legible than a generic “GraphRAG API” listing and more differentiated than a generic tracing or observability offer.

## Why this SKU first
- easiest to explain commercially
- strongest visible differentiation
- naturally bundles hosted convenience and governance controls
- less likely to be compared head-on with incumbent tracing vendors
- aligns with the strongest product wedge

## Secondary marketplace SKUs
1. **Graph-aware evaluator pack**  
   Additional evaluation workflows, regression comparison, and reporting.
2. **Lineage and governance pack**  
   Advanced export formats, controls, and retention.
3. **Optional API pack**  
   Hosted ingestion, reasoning-object APIs, and enterprise integration support.

## SKUs to avoid leading with
Do not lead with:
- generic GraphRAG platform
- generic reasoning API
- provider routing / BYOK abstraction
- generic observability or trace platform

Those are either crowded, too broad, or too easy to misread as another infrastructure layer.

## Marketplace sequence
### Stage 1
Self-serve site, docs, samples, and import-based workspace.

### Stage 2
Hosted team product with persistence, auth, billing, and basic admin.

### Stage 3
Enterprise controls, security artefacts, procurement readiness, and usage reporting.

### Stage 4
Marketplace listing for the hosted workspace SKU.

### Stage 5
Add-ons or expanded packages only once the wedge has traction.

## Commercial packaging
### Core package
- seats
- retained runs
- storage
- evaluator usage
- comparison history

### Enterprise package
- SSO / SCIM
- audit and governance exports
- policy controls
- deployment options
- support and onboarding

## Decision rule
Every marketplace listing should reinforce the same category claim:
Restormel is the graph-native reasoning debugger and evaluator that sits above existing traces, retrieval, and evidence systems.

If a listing weakens that message, do not ship it.
