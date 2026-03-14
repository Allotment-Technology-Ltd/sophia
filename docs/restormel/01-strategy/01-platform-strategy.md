# Restormel Platform Strategy

## Purpose
Define the platform position, build-vs-integrate boundaries, and first product wedge for Restormel as it is extracted from the SOPHIA codebase.

## Executive summary
Allotment Technology Ltd is the parent company.

Restormel is the platform: a graph-native reasoning debugger and evaluator for AI systems. Its role is to turn traces, retrieval events, evidence, and intermediate reasoning artefacts into structured reasoning objects that support debugging, evaluation, provenance inspection, contradiction inspection, graph-aware retrieval diagnostics, regression comparison, and governance-grade lineage.

SOPHIA is the flagship reference application and first downstream consumer. It proves the platform in a real product setting, but it is not the permanent end-state architecture.

Restormel should not try to win by rebuilding crowded categories. General-purpose tracing, generic RAG orchestration, vector infrastructure, provider layers, and baseline evals should mostly be integrated, adapted, or extended. Restormel should win by owning the layer above those substrates: reasoning graph compilation, canonical reasoning contracts, graph-native debugger UX, graph-aware evaluation, compare mode, and governance-ready lineage.

## Category
**Graph-native reasoning debugger and evaluator**

Restormel is not:
- a generic tracing tool
- a generic RAG framework
- a vector infrastructure wrapper
- a generic LLM observability product

Restormel is adjacent to:
- observability
- GraphRAG
- retrieval evaluation
- governance and audit tooling

## Strategic problem
AI teams can often inspect prompts, responses, tool calls, and retrieved documents. They still struggle to inspect:
- which claims were actually made
- what evidence supported each claim
- where the support was weak, missing, or contradictory
- whether retrieval was structurally sufficient
- what changed between runs, prompts, models, or evidence states
- how to produce governance-grade decision lineage

That missing layer is Restormel’s product space.

## Platform thesis
Restormel should compile opaque system activity into a reusable, queryable reasoning object that links:
- trace events
- claims
- evidence
- provenance
- support relations
- contradiction relations
- evaluations
- lineage and audit metadata

The reasoning object is the foundational asset. The workspace, evaluators, compare flows, APIs, and exports all sit on top of it.

## Build vs integrate

### COMMODITY — integrate / adapt / extend
Restormel should default to integration or extension for:
- tracing and telemetry substrates
- instrumentation standards
- generic RAG pipelines and orchestration
- graph storage and vector storage
- embeddings and rerankers
- provider and model access layers
- baseline retrieval and RAG metrics

### DIFFERENTIATED — build directly
Restormel should directly own:
- reasoning graph compilation
- canonical reasoning contracts
- provenance / support / contradiction modelling
- graph-native debugger UX
- compare mode for runs, graphs, and evidence states
- graph-aware retrieval diagnostics
- governance-ready lineage and audit exports

### ADJACENT — build narrowly where it sharpens the core
Restormel may own thin layers for:
- trace adapters and ingestion helpers
- evaluator execution harnesses
- run persistence and sharing
- SDKs for importing or emitting reasoning objects
- hosted collaboration and retention controls

## Product wedge
### First wedge
**Restormel Graph** — the reasoning workspace

A workspace that ingests traces, retrieval flows, and evidence and compiles them into a structured reasoning graph for inspection, evaluation, comparison, and sharing.

Why this wedge:
- proves the canonical reasoning object
- integrates with existing traces rather than replacing them
- gives teams an immediate “show me why this happened” workflow
- supports monetisation through retention, collaboration, compare mode, evaluation, and governance exports

### Supporting capability
**Graph-aware retrieval diagnostics**

This should be framed as a capability and monetisable add-on around the core workspace, not as a broad “we are a GraphRAG platform” claim.

## Product family

### 1. Reasoning workspace
The main surface for debugging, evidence inspection, contradiction inspection, support tracing, compare mode, and saved runs.

### 2. Graph-aware evaluators
Evaluators for support quality, contradiction exposure, evidence sufficiency, retrieval structure, reasoning defects, and regressions across runs.

### 3. Lineage and governance exports
Audit-ready artefacts for regulated and quality-sensitive teams.

### 4. Adapters and ingestion SDKs
Thin integration layers that let upstream systems send traces, retrieval events, and evidence into Restormel.

## Role of SOPHIA
SOPHIA is:
- the first downstream consumer
- the flagship reference application
- a proving ground for contracts, graph compilation, and debugger UX
- a source of extraction candidates

SOPHIA is not:
- the permanent platform architecture
- the only valid use case
- the product boundary that all platform decisions should optimise around

## Moat
Restormel’s moat is not generic tracing, generic RAG, or generic graph storage.

The moat is:
- a unified reasoning object that links graph, trace, evidence, provenance, evaluation, and auditability
- a debugger UX built around reasoning rather than logs
- graph-aware evaluators that inspect reasoning quality as reasoning
- compare workflows that expose changes in support, contradictions, and evidence state
- governance-grade lineage outputs grounded in the same canonical structure

## Commercial position
Restormel should be sold as the layer that helps teams understand why an AI system produced an answer, where the reasoning was weak, and what changed between runs.

That is stronger than selling a generic platform story because it is narrower, more legible, and better matched to an under-solved category.

## Near-term priorities
1. Finalise the canonical reasoning object.
2. Extract package boundaries that make SOPHIA a consumer of shared contracts.
3. Ship the reasoning workspace MVP.
4. Add graph-aware evaluators and compare mode.
5. Add retention, sharing, and lineage export as monetisable hosted capabilities.

## Decision frame for future work
For any new feature, ask:
1. Does this strengthen the reasoning object?
2. Does it improve reasoning debugging, graph-aware evaluation, compare mode, or lineage?
3. Can this be integrated from the ecosystem rather than rebuilt?
4. Does this push Restormel into a crowded substrate category?

If the answer to 4 is yes, default to integration rather than ownership.
