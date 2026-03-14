# Restormel GraphRAG MVP Specification

## Product name
Restormel GraphRAG

## Category
Plug-and-play graph-native retrieval toolkit for AI applications.

## Purpose
Help developers move beyond vector-only retrieval by producing graph-aware context packs, retrieval traces, and explorable graph outputs that connect naturally to Restormel Graph.

## Strategic role
Restormel GraphRAG is the second wedge product in the ecosystem.

It should:
- expose one of the most differentiated parts of the SOPHIA stack,
- integrate tightly with Restormel Graph,
- provide an obvious upgrade path from ordinary RAG,
- create a developer-first path into hosted APIs and the console.

---

## Core user jobs
1. I want better retrieval than plain chunk similarity.
2. I want to see how my retrieval system selected and expanded context.
3. I want graph-aware context packs for a downstream LLM.
4. I want retrieval traces I can debug visually.
5. I want an easier path to GraphRAG without building the whole stack myself.

---

## Target users
### Primary
- AI application developers
- RAG system builders
- search and retrieval engineers
- developers building assistants, copilots, or knowledge tools

### Secondary
- vibe coders who want hosted GraphRAG
- teams experimenting with explainable AI workflows

---

## Value proposition
**Upload or ingest documents, ask a question, and get a graph-backed context pack plus a visual trace.**

---

## MVP scope

### In scope
- small corpus ingestion
- hybrid lexical + dense retrieval
- seed selection
- graph expansion
- context-pack generation
- retrieval trace output
- graph output compatible with Restormel Graph
- local SDK mode
- hosted API mode

### Out of scope
- large enterprise ingestion pipelines
- custom ontology editors
- advanced training loops
- fine-tuned rerankers in v1
- multi-region enterprise data controls

---

## Product modes
### 1. Local SDK mode
For developers who want to run retrieval logic in their own stack.

Example:

```ts
import { createGraphRag } from '@restormel/graphrag-core'
```

### 2. Hosted API mode
For self-serve and faster adoption.

Endpoints:
- `POST /v1/ingest`
- `POST /v1/retrieve`
- `GET /v1/runs/:id`
- `GET /v1/graphs/:id`

---

## MVP workflow
1. ingest a small document set
2. normalize and segment content
3. generate initial graph-ready material
4. run hybrid retrieval against query
5. build seed set
6. expand graph neighbourhood
7. assemble context pack
8. emit retrieval trace and graph
9. open result in Restormel Graph

---

## Input support
### MVP input types
- plain text
- markdown
- simple web pages / URLs
- uploaded text files

### Later
- PDFs
- Google Docs / Notion connectors
- repo and codebase ingestion
- richer ontologies and domain packs

---

## Output contract
Every retrieval request should return:
- selected candidates
- seed set
- graph expansion record
- context pack
- graph document
- retrieval trace

This is the core differentiation.

---

## Retrieval pipeline requirements
### Candidate generation
- lexical search
- dense search
- merged candidates

### Seed construction
- balance relevance and diversity
- prefer structurally useful evidence when available

### Graph expansion
- relation-aware traversal
- configurable hop depth
- pruning of weak expansions

### Context assembly
- produce compact, structured context items
- preserve provenance

---

## MVP UX / product hooks
### Playground hook
“Upload docs and ask a question.”

Result:
- answer context
- graph preview
- retrieval trace
- button to open in Restormel Graph

### Developer hook
“Add graph-native retrieval to your AI app in minutes.”

Result:
- SDK install
- quickstart sample
- live API tester

---

## Technical architecture
### Depends on
- `@restormel/contracts`
- `@restormel/graph-core`
- `@restormel/graphrag-core`
- `@restormel/observability`
- optionally `@restormel/providers` for hosted embedding/model support

### App surfaces
- `apps/reasoning-api` for hosted endpoints
- `apps/restormel-playground` for trial experience
- `apps/restormel-console` for project management and run history

---

## MVP console capabilities
- create project
- ingest small document set
- run retrieve query
- inspect retrieval trace
- open graph in visualizer
- view usage and run history

---

## Success metrics
### Product metrics
- first ingestion completed
- first retrieval run completed
- open in graph visualizer clicked
- API key created
- project retained beyond first session

### Quality metrics
- ingestion success rate
- retrieval latency
- trace completeness rate
- graph render success rate downstream in Restormel Graph

---

## Launch positioning
**Restormel GraphRAG helps you move from opaque chunk retrieval to visible, graph-backed context.**

Proof points:
- hybrid retrieval
- graph-aware expansion
- traceable seed selection
- one-click visual debugging

---

## MVP deliverables
1. local SDK package
2. hosted retrieve endpoint
3. minimal ingest endpoint
4. retrieval trace schema implementation
5. graph output implementation
6. Restormel Graph integration
7. quickstart documentation
8. playground demo
