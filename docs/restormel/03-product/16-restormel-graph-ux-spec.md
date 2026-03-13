---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Build Pack 03: Restormel Graph UX Spec

## Purpose

This document defines the user experience for the first Restormel product: **Restormel Graph**.

Restormel Graph is the visual debugger for graph-based AI systems. Its job is to help users move from opaque traces and JSON to a clear understanding of:

- graph structure
- retrieval paths
- reasoning paths
- provenance
- weak points in the system

## Product Promise

**Paste a graph or trace and instantly understand how the system got its answer.**

## Primary Users

### 1. Technical professionals
People building AI applications who need to inspect retrieval and reasoning.

### 2. Vibe coders and novice builders
People using AI coding tools who need visual feedback rather than raw logs.

### 3. Internal SOPHIA users
People exploring argument maps and pass outputs.

## Core UX Principles

### 1. Immediate payoff
The first meaningful visual should appear in under ten seconds.

### 2. Progressive disclosure
Do not overwhelm users with the entire graph at once.

### 3. One system, three lenses
Users should be able to flip between:
- graph
- pipeline
- trace

### 4. Explain before optimize
The first version should help users understand the system before it helps them tune it.

## Main User Flows

## Flow A: Paste or upload graph

1. user lands on `/playground`
2. user pastes JSON or uploads a file
3. system validates the payload
4. graph renders in Graph view
5. inspector opens on the most central or selected node

### Success outcome
The user sees the system structure instantly.

## Flow B: Paste reasoning or retrieval trace

1. user uploads a `ReasoningTrace` or `RetrievalTrace`
2. system converts trace into graph snapshots and a timeline
3. default opens in Trace view with a highlighted answer path
4. user can switch to Graph view and inspect nodes

### Success outcome
The user understands how the answer path formed over time.

## Flow C: Open from SOPHIA or GraphRAG

1. user completes a query in SOPHIA or GraphRAG
2. user clicks **Open in Restormel**
3. relevant graph and trace open in a dedicated viewer route
4. user explores evidence, relations, and pass outputs

### Success outcome
Restormel becomes the debugging companion product.

## Information Architecture

## Primary navigation
- Playground
- Docs
- Templates
- Console

## In-app navigation
- Graph
- Pipeline
- Trace
- Compare

## Key Screens

### 1. Landing / Product page
Purpose:
- explain the value
- show examples
- get users into the playground

### 2. Playground
Purpose:
- input/upload graph or trace
- get instant visualization

### 3. Visualization workspace
Purpose:
- inspect graph, path, and trace

### 4. Saved run / share page
Purpose:
- share a saved visualization with a stable URL

## Workspace Layout

### Left rail
Controls and filters.

Sections:
- import source
- view mode
- filters
- layout options
- saved views

### Main canvas
Visualization area.

### Right panel
Inspector.

Tabs:
- Details
- Provenance
- Scores
- Related nodes

### Bottom optional drawer
Timeline or event stream.

## View Modes

## Graph View
Purpose:
show the structure of the graph.

Capabilities:
- zoom and pan
- fit to view
- search node by id or label
- cluster collapse/expand
- filter by node kind and edge kind
- highlight path from selected node to answer node

Default behavior:
- auto-layout on load
- high-signal nodes emphasized
- low-confidence edges visually subdued

## Pipeline View
Purpose:
show a simpler directional flow for novice users.

Default sections:
- query
- retrieval
- context pack
- analysis
- critique
- synthesis
- answer

This view is crucial for vibe coders because it turns a complex graph into a legible sequence.

## Trace View
Purpose:
show events and graph snapshots over time.

Capabilities:
- event timeline
- pass-by-pass playback
- snapshot scrubber
- jump to graph state at event N

## Compare View
Purpose:
compare runs or compare snapshots before and after a pass.

Capabilities:
- side-by-side graph stats
- changed nodes/edges
- changed path weights

## States

## Empty state
Message:
- explain acceptable inputs
- offer sample datasets
- offer sample SOPHIA trace
- offer sample GraphRAG trace

## Loading state
Show:
- lightweight parsing progress
- validation state
- fallback skeleton view

## Validation error state
Show:
- what failed
- expected schema
- quick fix examples
- button to view JSON help

## Sparse graph state
If graph is too small, default to inspector-first layout.

## Large graph state
If graph is too dense:
- collapse clusters
- highlight main path only
- show summary cards first

## Interaction Model

### Click node
- select node
- open inspector
- dim unrelated nodes slightly

### Click edge
- show relation details
- show evidence and scores

### Shift-click multiple nodes
- compare nodes in inspector

### Hover node
- preview summary and key relations

### Search
- focus matching node
- optionally pulse matching nodes

### Highlight path
User can choose:
- answer path
- contradiction path
- support chain
- retrieval chain

## Inspector Content

## Details tab
- node id
- node kind
- label
- summary
- pass origin
- timestamps if present

## Provenance tab
- source references
- passage refs
- model/provider origin where relevant

## Scores tab
- relevance
- confidence
- centrality
- selection reason if present

## Related tab
- strongest incoming edges
- strongest outgoing edges
- sibling nodes

## Design Notes

### Visual language
The UI should feel:
- precise
- calm
- analytical
- alive but not noisy

### Motion
Use small motion to communicate change:
- graph settle
- path highlight sweep
- timeline scrub transitions

Avoid decorative motion.

## Novice Mode vs Pro Mode

### Novice mode
Default on first load.

Shows:
- Pipeline view first for trace inputs
- simplified labels
- fewer controls
- guided explanations

### Pro mode
Accessible by toggle.

Shows:
- raw node ids
- edge metadata
- full filters
- schema and JSON tools

## MVP Interaction Priorities

### Must-have
- import graph JSON
- import trace JSON
- graph view
- pipeline view
- inspector
- basic filters
- path highlight
- shareable URLs

### Should-have
- compare view
- sample templates
- open from SOPHIA

### Later
- collaborative annotations
- graph editing
- live streaming from running sessions

## Magic Moment

The user pastes a trace and Restormel immediately highlights:

- the answer node
- the path that most influenced it
- the evidence and objections linked to that path

At that moment the product promise becomes obvious.

## Definition of Done for MVP UX

The UX spec is satisfied when a first-time user can:

1. paste a trace
2. see a visual structure immediately
3. identify the answer path
4. inspect at least one node and one edge
5. leave with a clearer mental model of how the system worked

## Summary

Restormel Graph should not feel like a generic graph viewer. It should feel like a **purpose-built debugger for graph-native AI systems**, with a strong guided experience for novice builders and enough depth for technical professionals.
