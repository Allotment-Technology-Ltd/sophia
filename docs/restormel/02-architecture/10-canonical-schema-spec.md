# Restormel Canonical Schema Specification

## Purpose
Define the canonical data contracts that make the Restormel ecosystem interoperable across packages, APIs, workspace views, exports, and the SOPHIA reference application.

## Core design decision
The primary contract is not just a graph document. It is a **Reasoning Object**.

A Reasoning Object is the canonical structure that links:
- run metadata
- trace events
- claims
- evidence
- provenance
- support and contradiction relations
- graph structure
- evaluator outputs
- lineage and audit metadata

## Design principles
- human-readable JSON first
- strongly typed TypeScript contracts
- validation through zod
- stable identifiers
- append-friendly metadata
- product-agnostic naming
- traceable lineage from source to summary

## Primary contracts

### `ReasoningObject`
Top-level canonical document.
Recommended fields:
- `id`
- `version`
- `run`
- `graph`
- `claims`
- `evidence`
- `provenance`
- `relations`
- `evaluations`
- `lineage`
- `artifacts`
- `meta`

### `RunRecord`
Describes the execution or import context.
Fields may include:
- `runId`
- `sourceSystem`
- `model`
- `promptVersion`
- `retrievalConfig`
- `timestamps`
- `environment`
- `tags`

### `GraphDocument`
Graph projection over the reasoning object.
Fields:
- `nodes`
- `edges`
- `stats`
- `subgraphs`

### `Claim`
Atomic or intermediate claim produced or inferred during the run.
Fields:
- `id`
- `text`
- `kind`
- `status`
- `confidence`
- `sourceRefs`

### `EvidenceItem`
A supporting or contradicting source fragment.
Fields:
- `id`
- `source`
- `excerpt`
- `locator`
- `modality`
- `qualitySignals`

### `ProvenanceRecord`
Links a claim, relation, or summary back to trace and evidence origins.
Fields:
- `id`
- `targetId`
- `traceRefs`
- `evidenceRefs`
- `transformRefs`
- `notes`

### `Relation`
Explicit relation between claims, evidence, or summaries.
Kinds should include:
- `supports`
- `contradicts`
- `derived_from`
- `retrieved_from`
- `summarises`
- `depends_on`

### `EvaluationResult`
Stores evaluator outputs over the reasoning object.
Fields:
- `evaluatorId`
- `targetIds`
- `score`
- `status`
- `notes`
- `evidenceRefs`

### `LineageArtifact`
Governance or audit-ready exportable summaries.
Fields:
- `artifactId`
- `type`
- `scope`
- `generatedAt`
- `inputs`
- `summary`
- `references`

## Trace import model
Restormel should support a separate import schema that maps external traces into the canonical model without assuming a single tracing vendor.

### `TraceImport`
Fields:
- `events`
- `retrievals`
- `toolCalls`
- `modelSteps`
- `sources`
- `meta`

## Compare model
Comparison should be first-class, not an afterthought.

### `ComparisonRecord`
Fields:
- `leftRunId`
- `rightRunId`
- `claimDiffs`
- `evidenceDiffs`
- `relationDiffs`
- `evaluationDiffs`
- `summary`

## Schema governance
- version contracts explicitly
- keep core fields stable
- allow metadata extension without breaking core consumers
- publish fixtures and examples
- ensure exports and APIs use the same canonical structures

## Why this matters
The reasoning object is the shared substrate for:
- workspace views
- compare mode
- evaluators
- APIs
- lineage exports
- SOPHIA integration

If this contract is weak, the whole platform becomes inconsistent.
