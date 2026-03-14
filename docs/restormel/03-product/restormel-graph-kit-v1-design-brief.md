# Restormel Graph Kit v1 — Design Brief

## Purpose

Design a gold-standard graph visualisation and inspection package for reasoning systems, with **SOPHIA as the first dogfooding integration target**.

This package should not be a decorative graph. It should be a **thinking surface** for inspecting, validating, and understanding how a reasoning system works.

The goal is to make reasoning:

- visible
- inspectable
- replayable
- challengeable
- explainable

The package will later become a reusable Restormel-native capability, but the first design should be grounded enough to plug into SOPHIA’s real graph and reasoning workflows.

## Product framing

**Working name:** Restormel Graph Kit v1

**First consumer:** SOPHIA

**Core job:**
Help a user understand:

- what the system concluded
- how it got there
- what evidence supports it
- what contradicts it
- what is inferred vs retrieved vs asserted
- where reasoning is weak, incomplete, or unresolved

This means the graph must support both:

- **structural understanding** of the reasoning network
- **process understanding** of how that network was built

## Design principles

The graph should feel like:

- precise
- calm
- analytical
- interactive
- trustworthy
- developer-grade
- semantically rich

The graph should **not** feel like:

- a decorative network diagram
- a flashy data visualisation demo
- a generic node editor
- a crypto-style graph
- a static architecture map

### Core principle

**The graph is a reasoning workspace, not an illustration.**

Users should be able to:

- inspect nodes and edges
- trace support and contradiction paths
- open provenance details
- replay graph evolution
- compare conflicting evidence
- focus on local reasoning without losing global context

## Primary user questions

The package should be designed around answering these questions quickly:

1. **What is this conclusion based on?**
2. **Which claims support or contradict this node?**
3. **What came from evidence, and what was inferred?**
4. **Where did this node come from?**
5. **How did the graph evolve over time?**
6. **What parts of the reasoning are weak or unresolved?**
7. **What changed between two reasoning states or runs?**
8. **What should I inspect next?**

If the graph does not help answer those questions, it is failing.

## Core surfaces

Graph Kit v1 should be designed as a composed experience with the following surfaces:

### A. Main graph canvas
Central interactive visualisation of nodes and edges.

### B. Inspector panel
Right-side detail view for the selected node or edge.

### C. Trace / playback panel
Bottom or side panel showing the sequence of reasoning actions over time.

### D. Provenance / evidence drawer
Expandable view for citations, evidence items, source excerpts, and support context.

### E. Summary / control bar
Top-level controls for filtering, search, layout, path highlighting, and view state.

## Canonical screen layout

Design one canonical application screen with this layout:

### Top bar
- query or run title
- search field
- filters
- layout control
- zoom/fit controls
- view mode toggle
- export/share action if needed

### Main center
- graph canvas occupying most of the screen

### Right panel
- inspector for selected node or edge
- metadata
- provenance
- actions

### Bottom panel
- trace timeline / event log / playback controls

### Optional drawer
- evidence drawer or compare drawer that can expand from the right or bottom

The canonical screen should feel like a serious developer tool or analytical console.

## Node taxonomy

Graph Kit v1 should support semantically distinct node types. Use these as the initial design taxonomy.

### Required node types

**1. Claim**
- atomic proposition or reasoning statement
- most common node type

**2. Evidence**
- retrieved fact, quote, source-backed snippet, or observed datum

**3. Source**
- document, URL, file, or origin container for evidence

**4. Inference**
- reasoning step or transformation that connects premises to a conclusion

**5. Query / Question**
- user question, prompt, task, or issue being explored

**6. Conclusion**
- final or current answer / synthesis / output node

**7. Contradiction**
- explicit conflict or flagged inconsistency

**8. Synthesis**
- higher-order summary or merged reasoning state

### Optional future node types
- assumption
- uncertainty
- rule / policy
- tool invocation
- validator check
- agent contribution

### Node requirements
Each node type should support:
- icon
- label/title
- type indicator
- short preview
- state styling
- expandable metadata
- provenance indicator if relevant

## Edge taxonomy

Edges must carry meaning. Do not treat all edges as visually identical.

### Required edge types

**Supports**
- this node supports another node

**Contradicts**
- this node conflicts with another node

**Derived from**
- conclusion or inference originated from another node or step

**Cites**
- claim references evidence or source

**Retrieved from**
- evidence came from a source

**Inferred by**
- claim was generated via a reasoning step

**Unresolved**
- relationship exists but remains uncertain or weak

### Edge requirements
Edges should differ through a combination of:
- stroke treatment
- semantic color
- arrow direction
- label or badge where useful
- emphasis when selected/highlighted

## State model

The graph must communicate state clearly.

### Node states
- default
- hovered
- selected
- related-to-selection
- path-highlighted
- verified
- unresolved
- contradicted
- dimmed/out-of-focus
- filtered out

### Edge states
- default
- hovered
- selected
- active path
- supported
- contradiction
- inferred
- unresolved
- dimmed/out-of-focus

### Global graph states
- loading
- empty
- sparse graph
- dense graph
- no results
- filtered view
- playback mode
- compare mode

## Interaction model

The design should assume these interactions are first-class.

### Core interactions
- hover node
- select node
- select edge
- pan and zoom
- fit graph to viewport
- expand local neighborhood
- collapse local neighborhood
- highlight incoming supports
- highlight contradictions
- highlight provenance path
- focus on selected path
- reset view

### Secondary interactions
- search for node or source
- filter by node type
- filter by edge type
- filter by reasoning state
- filter by confidence
- switch layout mode
- compare two runs / two subgraphs
- open evidence drawer
- replay graph construction

### UX principle
The graph must make it easy to go from:
**overview → local inspection → provenance → timeline → back to overview**

## Inspector panel spec

The inspector is one of the most important parts of the design.

When a node is selected, show:

### Header
- node title
- node type
- status/state badge
- confidence badge if relevant

### Summary
- short readable description of the node

### Metadata
- origin
- creation method
- model or agent if applicable
- timestamp
- confidence
- ID or reference
- associated run/session

### Relationships
- supports
- contradicted by
- derived from
- cited evidence
- downstream effects

### Provenance
- evidence chips
- source links
- citation excerpts
- validation notes

### Actions
- highlight path
- show evidence
- compare
- isolate neighborhood
- replay from here

For edge selection, show:
- relation type
- source node
- target node
- confidence/strength
- explanation
- provenance if any

## Trace / playback spec

This is a key differentiator and should feel premium.

The system should show how the graph came into being over time.

### Trace event types
- query received
- retrieval started
- evidence added
- claim created
- inference produced
- contradiction detected
- validation run
- synthesis completed
- final output created

### Playback requirements
- timeline list of events
- current step highlight
- play/pause
- scrub through events
- jump to event
- graph updates as playback progresses
- selected event should highlight affected nodes/edges

### UX goal
The user should be able to understand:
**not just what the graph is, but how it emerged**

## Provenance and evidence model

This should be one of the signature strengths of the package.

### Provenance components
- citation chips
- source badges
- evidence drawer
- excerpt cards
- support/contradiction evidence grouping
- validation notes

### Provenance UX goals
The user should always be able to answer:
- where did this claim come from?
- what evidence supports it?
- what challenges it?
- was it retrieved, inferred, asserted, or synthesized?
- how strong is the support?

## Compare mode

The package should support comparing:
- two runs
- two graph states
- two conflicting claims
- two evidence sets

### Compare surfaces
- diff panel
- changed node states
- changed edge states
- added/removed claims
- confidence changes
- contradiction changes

This is especially useful for SOPHIA when comparing reasoning outputs or verification states.

## Layout behaviour

The graph canvas should be designed for multiple real conditions:

### Scenarios
- tiny graph
- medium graph
- dense graph
- clustered graph
- highly linear trace
- branching reasoning tree
- contradiction hotspot
- provenance-heavy graph

### Design requirement
The UI should remain usable even when the graph becomes messy.
That means the design must include:
- local focus mode
- neighborhood expansion
- path highlighting
- dimming of non-relevant nodes
- filtering
- clustering or grouping cues

## Visual direction

Use the existing Restormel system direction:
- dark mode first
- restrained palette
- strong hierarchy
- subtle depth
- clean technical typography
- semantic color roles
- calm, serious, inspectable

### Semantic color logic
- blue = active / selected / primary action
- teal = verified / healthy / supported
- amber = unresolved / warning / partial
- coral = contradiction / failure / error
- purple = synthesis / higher-order reasoning

Do not overuse color. It should signal meaning, not decoration.

## Accessibility and readability

The graph package should prioritise clarity over novelty.

Requirements:
- readable text at small sizes
- sufficient contrast in dark mode
- color not used as the only meaning carrier
- selected state always obvious
- active path always obvious
- tooltips and panels readable without visual clutter

## Deliverables for the first design pass

Produce the following design artefacts:

### A. Canonical full-screen graph experience
One polished application screen with:
- top controls
- graph canvas
- right inspector
- bottom trace timeline
- evidence/provenance affordances

### B. Node taxonomy sheet
All node types with visual states.

### C. Edge taxonomy sheet
All edge types with visual states.

### D. Interaction/state sheet
Hover, select, related, contradiction, unresolved, playback, compare.

### E. Provenance/evidence patterns
Citation chips, source cards, evidence drawer, validation notes.

### F. Trace/playback patterns
Timeline, event cards, playback scrubber, event-linked graph highlighting.

### G. Empty/dense/error states
No graph, no results, unresolved graph, overloaded graph.

## SOPHIA integration assumptions

Design with SOPHIA in mind as the first implementation target.

Assume the graph may need to represent:
- claims
- evidence
- sources
- reasoning links
- contradiction flags
- confidence
- epistemic or validation states
- run history / trace evolution

The design should be adaptable to imperfect or incomplete data.
Do not assume every node has perfect metadata.

## Success criteria

Graph Kit v1 is successful if a user can:
- identify major node and edge types immediately
- click a claim and understand its support structure
- inspect provenance without losing context
- see contradiction and uncertainty clearly
- replay how the reasoning graph was formed
- compare reasoning states or runs
- stay oriented in the graph even when it becomes dense

## Recommended repository placement

### If you are already in the target Restormel monorepo
Place this file at:

```text
docs/product/restormel-graph-kit-v1-design-brief.md
```

This fits the documented monorepo structure where `docs/` holds planning, product architecture, ADRs, and internal specifications, and where product-facing specifications sit under `docs/product/`.

### If you are still inside the current SOPHIA repo
Use a transitional path such as:

```text
docs/restormel/restormel-graph-kit-v1-design-brief.md
```

or, if you do not yet have a Restormel docs area:

```text
docs/product/restormel-graph-kit-v1-design-brief.md
```

That keeps the brief close to the future target structure and makes migration into the monorepo straightforward.

## Notes for implementation

This brief should pair with:
- the Restormel Graph MVP spec
- the Restormel Graph UX spec
- the package boundary spec
- the monorepo folder blueprint

Implementation should treat this document as:
- the design intent source
- the interaction contract for the graph package
- the dogfooding target for SOPHIA integration
