# Restormel Graph-Aware Retrieval Diagnostics Specification

## Product name
Restormel Retrieval Diagnostics

## Category
Graph-aware retrieval diagnostics capability for reasoning-heavy AI systems.

## Purpose
Help teams inspect whether retrieval was structurally sufficient for the reasoning a system attempted, without positioning Restormel as a generic GraphRAG infrastructure vendor.

## Strategic role
This is a supporting capability and monetisable add-on around the core reasoning workspace.

It should:
- expose retrieval structure in a way the workspace can inspect
- diagnose weak retrieval paths, missing evidence coverage, and low-support claim areas
- complement existing retrieval and RAG pipelines rather than replace them

## Core user jobs
- inspect which evidence paths were available to a run
- detect evidence gaps
- understand where claim support failed because retrieval was thin or misdirected
- compare retrieval state across runs
- surface graph-aware diagnostics beyond baseline hit-rate style metrics

## What it is not
- not a broad end-to-end GraphRAG platform
- not a replacement for vector DBs or orchestration frameworks
- not a generic retrieval framework

## MVP scope
### Must include
- ingestion of retrieval events or retrieval summaries
- evidence-path visualisation in the workspace
- diagnostics for coverage, support sufficiency, and structural blind spots
- compare mode for retrieval state changes
- exportable diagnostic summary

### Should integrate with
- existing retrievers
- graph stores
- baseline retrieval metrics
- upstream RAG frameworks

## Commercial framing
Sell this as:
- graph-aware retrieval diagnostics
- retrieval support analysis
- evidence-path visibility

Do not sell it as:
- a universal GraphRAG stack
- a new orchestration platform

## Why it matters
This capability sharpens the main wedge because many reasoning failures are retrieval-structure failures in disguise.
