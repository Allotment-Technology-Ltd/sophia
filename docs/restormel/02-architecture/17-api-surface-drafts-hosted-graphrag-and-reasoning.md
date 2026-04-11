# Restormel Build Pack 04: API Surface Drafts for Reasoning Objects, Comparison, and Lineage

## Purpose
Define the first public API shape for Restormel-hosted workflows without positioning the product as a generic GraphRAG or orchestration platform.

## API design principles
1. JSON first
2. canonical reasoning object first
3. import-friendly and adapter-friendly
4. comparison as a first-class workflow
5. exportable lineage and evaluation outputs
6. provider-agnostic where needed, not provider-platform-first

## Core API families

### 1. Import API
Accept trace, retrieval, and evidence data and compile to a reasoning object.

Example resources:
- `POST /v1/import/run`
- `POST /v1/import/batch`

### 2. Reasoning Object API
Read and query compiled reasoning objects.
- `GET /v1/runs/{id}`
- `GET /v1/runs/{id}/graph`
- `GET /v1/runs/{id}/claims`
- `GET /v1/runs/{id}/evidence`

### 3. Compare API
Compare two runs or two reasoning objects.
- `POST /v1/compare`
- `GET /v1/compare/{id}`

### 4. Evaluator API
Execute graph-aware evaluators.
- `POST /v1/evals/run`
- `GET /v1/evals/{id}`

### 5. Lineage Export API
Generate governance and audit artefacts.
- `POST /v1/exports/lineage`
- `POST /v1/exports/comparison-summary`

## Example top-level response shape
```json
{
  "runId": "run_123",
  "reasoningObjectId": "ro_123",
  "status": "ready",
  "links": {
    "graph": "/v1/runs/run_123/graph",
    "claims": "/v1/runs/run_123/claims",
    "evidence": "/v1/runs/run_123/evidence"
  }
}
```

## API boundaries
The API should own:
- reasoning object compilation
- comparison
- evaluator execution
- lineage export

The API should not own:
- broad model provider routing
- generic retrieval orchestration
- vector or graph infra abstraction
- general-purpose tracing

## Commercial packaging
Meter:
- imports
- retained runs
- evaluator executions
- comparison history
- export generation

Do not package the API as a generic platform substrate.
