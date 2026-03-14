# Restormel Build Pack 02: First Extraction Backlog by File and Module

## Purpose
Define the first practical extraction sequence from SOPHIA into Restormel packages.

## Extraction strategy
Work in waves, not a single refactor. Tag work by category ownership.

## Wave 1 — Contracts
**Classification:** DIFFERENTIATED  
Extract:
- IDs and enums
- graph node/edge types
- claim, evidence, provenance, relation, evaluation, lineage contracts
- zod validators
- test fixtures

## Wave 2 — Graph core
**Classification:** DIFFERENTIATED  
Extract:
- graph transforms
- graph stats helpers
- traversal and path helpers
- diff and compare utilities

## Wave 3 — Reasoning core
**Classification:** DIFFERENTIATED  
Extract:
- claim / evidence compilation logic
- provenance binding
- relation synthesis
- contradiction and support modelling
- evaluation orchestration hooks

## Wave 4 — Adapters and observability
**Classification:** ADJACENT  
Extract:
- trace import adapters
- retrieval event adapters
- export helpers
- internal inspection helpers

## Wave 5 — UI surfaces
**Classification:** DIFFERENTIATED  
Extract:
- graph workspace primitives
- claim and evidence inspectors
- compare panes
- lineage export UI

## Wave 6 — Hosted concerns
**Classification:** ADJACENT / COMMODITY  
Extract only as needed:
- auth integration
- persistence boundaries
- billing hooks
- provider wrappers

## What to deprioritise
- generic provider platform work
- broad BYOK abstraction
- generic GraphRAG runtime ownership
- standalone observability ambitions

## Success criteria
Each wave should leave SOPHIA working while reducing hidden platform coupling.
