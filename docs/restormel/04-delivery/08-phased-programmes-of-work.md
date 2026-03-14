---
title: Restormel Platform Phased Programmes of Work
owner: platform-delivery
product: restormel
doc_type: delivery_plan
last_reviewed: 2026-03-14
sync_to_linear: false
status: active
source_of_truth: true
---

# Restormel Platform Phased Programmes of Work

## Purpose
Break the implementation journey into phased programmes that reflect Restormel’s revised strategic position.

## Delivery model
Run the work as parallel programmes rather than a single linear backlog.

### Programme A
Contracts, reasoning core, and extraction

### Programme B
Reasoning workspace product

### Programme C
Site, docs, and playground

### Programme D
Evaluators, compare mode, and lineage

### Programme E
Hosted operations and enterprise readiness

## Phase 0 — Foundation
Outputs:
- naming and hierarchy locked
- package boundaries agreed
- canonical reasoning object direction fixed
- extraction backlog tagged by differentiated vs commodity

## Phase 1 — Extraction
Outputs:
- `@restormel/contracts`
- `@restormel/graph-core`
- first `@restormel/reasoning-core`
- SOPHIA consuming shared contracts where practical

## Phase 2 — Wedge product
Outputs:
- reasoning workspace MVP
- support / contradiction / provenance inspectors
- import flow for sample and real runs

## Phase 3 — Evaluation and comparison
Outputs:
- graph-aware evaluator primitives
- compare mode for runs and evidence states
- diff summaries and regression workflows

## Phase 4 — Hosted product
Outputs:
- auth
- saved runs
- retention
- collaboration
- pricing and usage model

## Phase 5 — Governance and enterprise
Outputs:
- lineage exports
- policy and admin controls
- procurement readiness
- marketplace packaging where justified

## Phase constraints
- do not bring forward enterprise packaging before the wedge is credible
- do not overbuild provider and orchestration layers
- keep GraphRAG capability subordinate to the core debugger/evaluator story
