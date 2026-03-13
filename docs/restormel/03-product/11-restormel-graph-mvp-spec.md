---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Graph MVP Specification

## Product name
Restormel Graph

## Category
Visual debugger for graph-based AI systems.

## Purpose
Give developers and advanced builders an immediate way to inspect, understand, and share graph and trace data from GraphRAG, reasoning systems, and other graph-like AI pipelines.

## Strategic role
Restormel Graph is the first wedge product for the Restormel platform.

It should:
- improve SOPHIA immediately,
- stand alone as a developer tool,
- create the easiest entry point into the platform,
- provide the visual proof for the rest of the ecosystem.

---

## Core user jobs
1. I want to upload a graph and understand its structure.
2. I want to inspect why a chatbot or reasoning engine produced a specific answer.
3. I want to highlight the most important path through the graph.
4. I want to share a visual explanation of my AI pipeline with colleagues.
5. I want to debug weak, missing, or contradictory connections.

---

## Target users
### Primary
- AI developers
- GraphRAG builders
- LLM product engineers
- research tool builders

### Secondary
- vibe coders building AI apps
- technical product managers
- educators and explainability-focused teams

---

## Value proposition
**Paste a graph or trace and see what your AI system is doing.**

---

## MVP scope

### In scope
- anonymous or light-auth upload / paste of graph JSON
- anonymous or light-auth upload / paste of trace JSON
- graph rendering
- node and edge inspector
- path highlighting
- filters by node kind, edge kind, and confidence
- timeline / trace view for reasoning or retrieval runs
- read-only share links
- SOPHIA trace adapter

### Out of scope
- collaborative graph editing
- write-back to source systems
- enterprise connectors in v1
- permissions model beyond basic share links
- advanced analytics dashboards
- real-time multiplayer sessions

---

## Supported inputs in MVP
### Native
- `GraphDocument`
- `ReasoningTrace`
- `RetrievalTrace`

### Adapters
- SOPHIA trace export
- simple custom graph JSON import

### Later
- LangChain trace adapter
- LlamaIndex trace adapter
- Neo4j adapter
- NetworkX adapter

---

## Primary views

### 1. Graph view
Force-directed or hybrid structured graph canvas.

Must support:
- zoom
- pan
- select node
- select edge
- focus neighbourhood
- fit to screen
- search node by label or id

### 2. Pipeline view
A simpler flow layout for users who do not want a dense graph first.

Must support:
- query to retrieval to reasoning to answer sequence
- click through into graph entities

### 3. Trace timeline
Step-by-step chronological events.

Must support:
- pass starts / completes
- retrieval phases
- warnings and errors
- graph snapshots over time

---

## Inspector requirements
Clicking a node or edge should reveal:
- id
- kind
- label
- summary if present
- source references
- confidence or relevance scores
- related nodes
- path membership
- originating pass or retrieval step if available

---

## Filters and controls
MVP controls should include:
- node kind filter
- edge kind filter
- confidence threshold slider
- hide isolated nodes toggle
- highlight answer path toggle
- highlight contradictions toggle
- layout mode switch

---

## Visualisation principles
- beautiful defaults
- minimal cognitive load
- progressive disclosure
- colour by semantic type, not decoration
- path emphasis over graph clutter
- do not overwhelm first-time users

---

## The magic moment
A user pastes a trace and within seconds sees:
- the key graph,
- the answer path,
- the source-backed supporting chain,
- the objection or contradiction points if present.

That moment must work with no configuration.

---

## MVP UX flow
### Path A: quick try
1. land on `restormel.dev/playground`
2. paste a sample graph or SOPHIA trace
3. graph renders immediately
4. click node and inspect
5. toggle answer path
6. share read-only link or create account

### Path B: signed-in
1. create account
2. upload traces
3. save traces to project
4. open in console
5. view history and compare runs

---

## Technical architecture
### Depends on
- `@restormel/contracts`
- `@restormel/graph-core`
- `@restormel/observability`
- `@restormel/sdk`
- `@restormel/ui`

### App surfaces
- `apps/restormel-playground`
- `apps/restormel-console`
- optional embedded panel inside `apps/sophia`

### Suggested frontend stack
- SvelteKit
- graph rendering via Cytoscape.js or Sigma.js
- trace timeline as standard component system
- state via typed stores

---

## Data handling
### Anonymous mode
- client-side parsing where possible
- optional temporary server-side upload for shared links

### Signed-in mode
- save traces and graphs per project
- retain basic metadata and preview snapshots

---

## Success metrics
### Product metrics
- first graph rendered
- first inspector open
- path highlight used
- share link generated
- account conversion from playground

### Quality metrics
- parse success rate
- time to first render
- time to interactive
- crash-free session rate

---

## Launch positioning
**Restormel Graph is the easiest way to visualise and debug graph-based AI systems.**

Example proof points:
- upload a SOPHIA trace
- inspect a GraphRAG answer path
- find contradictions and weak links
- share a visual explanation with your team

---

## MVP deliverables
1. canonical import support
2. graph canvas
3. node and edge inspector
4. trace timeline
5. path highlighting
6. shareable read-only links
7. sample data fixtures
8. documentation and quickstart page
