---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Build Pack 04: API Surface Drafts for Hosted GraphRAG and Reasoning

## Purpose

This document defines the first public API shape for the hosted Restormel platform products:

- Restormel GraphRAG API
- Restormel Reasoning API

These drafts are intended to support:

- hosted use from `restormel.dev`
- SDK generation
- self-serve technical adoption
- marketplace-ready SaaS packaging later

## API Design Principles

### 1. JSON first
The API must be easy to use from curl, JS, Python, and no-code tools.

### 2. Trace always available
Every meaningful run should return a machine-readable trace.

### 3. Graph as a first-class output
Graph-native state is not hidden internal data.

### 4. Streaming and batch support
Developers should be able to choose between:
- simple blocking requests
- event-stream responses

### 5. Provider flexible
The hosted API should support platform-managed providers first, then BYOK where appropriate.

## Authentication Model

### Initial model
- API key in header
- project-scoped keys

Example:

```http
Authorization: Bearer rtm_xxxxx
```

### Later
- service accounts
- scoped tokens
- marketplace entitlements

## Versioning

Use URL versioning from the start.

```text
/v1/
```

## Base Paths

```text
/v1/graphrag
/v1/reasoning
/v1/runs
/v1/graphs
/v1/providers
```

# Part A: GraphRAG API

## Product promise
Turn documents and a user query into a graph-backed context pack, plus a trace explaining retrieval and expansion.

## Core endpoints

### `POST /v1/graphrag/retrieve`
Runs a GraphRAG retrieval workflow.

#### Request
```json
{
  "query": "What are the main objections to rule utilitarianism?",
  "documents": [
    {
      "id": "doc_1",
      "title": "Rule Utilitarianism Notes",
      "text": "..."
    }
  ],
  "options": {
    "depth": "standard",
    "maxSeeds": 12,
    "maxHops": 2,
    "returnTrace": true,
    "returnGraph": true
  }
}
```

#### Response
```json
{
  "runId": "run_123",
  "contextPack": {
    "summary": "...",
    "items": []
  },
  "graph": {
    "nodes": [],
    "edges": [],
    "metadata": { "schemaVersion": "1.0.0" }
  },
  "trace": {
    "events": []
  },
  "metrics": {
    "durationMs": 1820,
    "candidateCount": 48,
    "seedCount": 12
  }
}
```

### `POST /v1/graphrag/ingest`
Creates or updates a corpus/project dataset.

#### Request
```json
{
  "projectId": "proj_123",
  "documents": [
    {
      "id": "doc_1",
      "title": "Essay 1",
      "text": "...",
      "metadata": { "sourceType": "manual" }
    }
  ]
}
```

#### Response
```json
{
  "ingestionId": "ing_123",
  "status": "accepted",
  "documentCount": 1
}
```

### `GET /v1/graphrag/runs/:runId`
Returns a stored run with graph and trace metadata.

### `GET /v1/graphrag/graphs/:graphId`
Returns a stored graph document.

### `GET /v1/graphrag/projects/:projectId`
Returns project metadata and ingestion status.

## Streaming variant

### `POST /v1/graphrag/retrieve/stream`
Returns SSE events.

Event examples:
- `run_start`
- `candidate_generation_complete`
- `seed_set_complete`
- `graph_expansion_complete`
- `context_pack_complete`
- `graph_snapshot`
- `run_complete`

## SDK shape

### JavaScript example
```ts
const result = await client.graphrag.retrieve({
  query: 'What is the central disagreement?',
  documents,
  options: { depth: 'standard' }
})
```

## MVP GraphRAG API scope

### In scope
- ingest docs
- retrieve
- return graph
- return trace
- store run

### Out of scope initially
- advanced multi-tenant corpus policies
- fine-grained role controls
- external vector store integrations
- custom reranker plug-ins

# Part B: Reasoning API

## Product promise
Turn a query plus optional graph-backed context into structured multi-pass reasoning.

## Core endpoints

### `POST /v1/reasoning/run`
Runs the analysis, critique, and synthesis pipeline.

#### Request
```json
{
  "query": "Is utilitarianism compatible with rights?",
  "contextPack": {
    "summary": "...",
    "items": []
  },
  "graph": {
    "nodes": [],
    "edges": [],
    "metadata": { "schemaVersion": "1.0.0" }
  },
  "options": {
    "mode": "standard",
    "stream": false,
    "returnTrace": true,
    "returnGraph": true
  },
  "provider": {
    "mode": "platform"
  }
}
```

#### Response
```json
{
  "runId": "run_456",
  "analysis": {
    "text": "...",
    "claims": []
  },
  "critique": {
    "text": "...",
    "claims": []
  },
  "synthesis": {
    "text": "...",
    "claims": []
  },
  "graph": {
    "nodes": [],
    "edges": [],
    "metadata": { "schemaVersion": "1.0.0" }
  },
  "trace": {
    "events": []
  },
  "metrics": {
    "durationMs": 4220,
    "tokenUsage": {
      "input": 0,
      "output": 0
    }
  }
}
```

### `POST /v1/reasoning/run/stream`
Returns the reasoning run over SSE.

Event examples:
- `run_start`
- `pass_start`
- `pass_chunk`
- `claims`
- `relations`
- `graph_snapshot`
- `pass_complete`
- `run_complete`

### `GET /v1/reasoning/runs/:runId`
Returns a stored reasoning run and metadata.

### `POST /v1/reasoning/verify`
Optional follow-on verification pass for later expansion.

## Provider options

### Platform-managed provider
```json
{
  "provider": {
    "mode": "platform",
    "model": "gemini-2.5-pro"
  }
}
```

### BYOK later
```json
{
  "provider": {
    "mode": "byok",
    "provider": "openai",
    "credentialRef": "cred_123",
    "model": "gpt-5"
  }
}
```

## Run persistence model

Every hosted run should produce:
- `runId`
- summary metadata
- graph id if graph exists
- trace id if stored separately
- shareable console link where appropriate

## Error model

Use a consistent JSON envelope.

```json
{
  "error": {
    "code": "invalid_schema",
    "message": "GraphDocument metadata.schemaVersion is required",
    "details": {}
  }
}
```

## Webhook support later

Planned later for async or enterprise workflows.

Possible events:
- `run.completed`
- `run.failed`
- `ingestion.completed`

## Suggested SDK namespaces

### JavaScript
- `client.graphrag.retrieve()`
- `client.graphrag.ingest()`
- `client.reasoning.run()`
- `client.reasoning.stream()`

### Python
- `client.graphrag.retrieve()`
- `client.reasoning.run()`

## Console integration

Every API run should be inspectable in the Restormel console with:
- request payload summary
- graph output
- trace output
- usage and errors

## Marketplace packaging implications

These API shapes support later cloud marketplace packaging because they make the hosted products legible as SaaS SKUs:

- GraphRAG API
- Reasoning API
- optional combined Restormel platform plan

## MVP API Definition of Done

### GraphRAG API MVP
- ingest endpoint
- retrieve endpoint
- graph output
- trace output
- API key auth

### Reasoning API MVP
- batch run endpoint
- streaming endpoint
- run retrieval endpoint
- graph and trace outputs

## Summary

The hosted APIs should expose the platform’s real differentiators rather than hiding them. The key design decision is to treat **graph state and trace state as first-class outputs**, because those are what make Restormel valuable and distinct.
