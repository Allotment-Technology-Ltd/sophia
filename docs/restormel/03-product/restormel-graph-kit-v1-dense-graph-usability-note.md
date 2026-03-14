# Restormel Graph Kit v1: Dense Graph Usability Note

## What Was Improved In This Slice

The workspace now has practical dense-graph controls without replacing the current layout engine:

- local focus mode
- neighborhood isolation
- configurable neighborhood depth
- dimming for out-of-scope nodes and edges
- reversible node-type and edge-type filters

These changes are intended to keep the reasoning workspace usable before a more serious layout system exists.

## Where Readability Breaks Down Today

The current renderer still uses the legacy orbital layout, which is acceptable for small and medium graphs but degrades in predictable ways.

Observed failure modes:

1. once visible node count gets into the mid-30s and beyond, labels compete for the same central space
2. cross-source support and contradiction edges create heavy crossings because the layout is still mostly source-centric
3. graphs with many claim-to-claim relations and weak source containment lose spatial meaning quickly
4. orphan or non-source-clustered claims collapse toward the center, which makes local structure harder to parse
5. there is no explicit path-aware or contradiction-aware layout pass yet, so important reasoning routes are not spatially privileged

These are current layout constraints, not user error.

## Practical Guidance For Current Use

Until the layout system improves, the recommended interaction sequence is:

1. filter to relevant node and edge kinds
2. select a node of interest
3. switch to local focus or isolate neighborhood
4. expand from 1 hop to 2 or 3 hops only when needed
5. use path highlighting for support or contradiction inspection

That flow gives a useful reasoning workspace without pretending the global layout is fully solved.

## Recommended Next Improvements

### Clustering

- cluster by source, pass, and reasoning role rather than source alone
- allow collapse/expand of source groups and synthesis groups
- add contradiction bundles so contested regions read as a unit

### Grouping

- group dense claim neighborhoods into semantic bundles
- add optional phase lanes for retrieval, analysis, critique, and synthesis
- add source containers that can be temporarily collapsed into badges or stacks

### Path-Focused Layouts

- path-first layout for selected conclusion/support chains
- contradiction-first layout for contested neighborhoods
- neighborhood re-layout around the selected node rather than global recompute only

### Interaction

- pin multiple focal nodes
- save named view states
- expose “expand one more hop” and “collapse outer ring” as explicit controls
- add keyboard stepping through support and contradiction neighbors

## Extraction Boundary

These improvements should remain split across:

- Graph Kit workspace state and scope helpers
- Graph Kit canvas rendering behavior
- future layout strategies
- SOPHIA-specific graph adapters

The current local-focus and dimming logic is extraction-friendly because it lives above the SOPHIA adapter and does not depend on raw SOPHIA graph internals.
