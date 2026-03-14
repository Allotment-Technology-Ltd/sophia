# Restormel Package Boundary Specification

## Purpose
Define package boundaries for incremental extraction from SOPHIA into Restormel, with explicit build-vs-integrate discipline.

## Boundary principle
Extract stable contracts first, then reusable runtime modules, then product surfaces. Keep crowded substrate concerns thin.

## Monorepo target structure
```text
/apps
  /sophia
  /restormel-web
/packages
  /contracts
  /graph-core
  /reasoning-core
  /evals
  /adapters
  /observability
  /ui
  /providers
/tooling
```

## Package classifications

### `@restormel/contracts`
**Classification:** DIFFERENTIATED  
**Role:** Canonical reasoning object contracts, validators, DTOs, and serialisation rules.  
**Must own:** claims, evidence, provenance, contradiction, lineage, trace import schema, evaluation results.  
**Must not own:** UI logic, provider logic, database adapters.

### `@restormel/graph-core`
**Classification:** DIFFERENTIATED  
**Role:** graph modelling, traversal, diffing, filters, transforms.  
**Must own:** generic graph operations over canonical shapes.  
**Must not own:** claim extraction, provider calls, UI rendering.

### `@restormel/reasoning-core`
**Classification:** DIFFERENTIATED  
**Role:** compile traces, retrieval flows, and evidence into reasoning objects.  
**Must own:** relation synthesis, provenance binding, contradiction detection, evaluation orchestration hooks.  
**Must not own:** general RAG orchestration, provider routing.

### `@restormel/evals`
**Classification:** DIFFERENTIATED  
**Role:** graph-aware evaluators and comparison summaries.  
**Must own:** support quality, contradiction exposure, evidence sufficiency, run deltas.  
**Must not own:** generic benchmark suite ownership.

### `@restormel/adapters`
**Classification:** ADJACENT  
**Role:** thin import/export layers for external traces, retrieval events, evidence bundles, and ecosystem tools.  
**Must own:** mapping and validation.  
**Must not own:** upstream orchestration logic.

### `@restormel/observability`
**Classification:** ADJACENT  
**Role:** internal instrumentation and inspection helpers for Restormel.  
**Must not own:** a generic observability platform.

### `@restormel/ui`
**Classification:** DIFFERENTIATED  
**Role:** reusable reasoning workspace primitives, inspectors, compare panes, and lineage views.  
**Must not own:** raw app-specific data access without adapters.

### `@restormel/providers`
**Classification:** COMMODITY / ADJACENT  
**Role:** minimal provider abstractions only where required for hosted flows.  
**Must not own:** a broad provider ecosystem or routing product.

## Reuse candidates
- OpenTelemetry / OpenInference style events
- existing graph DBs
- existing rerankers and embeddings
- baseline eval libraries
- framework-specific ingestion adapters

## Package decision rule
A package should exist only when it creates a reusable boundary that:
- separates differentiated logic from commodity substrate
- supports SOPHIA as a downstream consumer
- makes the canonical reasoning object more portable
