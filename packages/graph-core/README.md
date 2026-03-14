# @restormel/graph-core

Renderer-agnostic graph logic for Restormel Graph.

## Package scope

- graph projection from retrieval-like inputs
- graph summaries and diffs
- graph layout helpers that do not depend on UI state
- graph trace tag helpers
- compiled graph workspace operations such as filtering, neighborhood scoping, and readability analysis
- graph-native reasoning evaluation primitives

## Current exports

- `projectGraph(input)`
- `diffGraphs(before, after)`
- `summarizeGraph(graph)`
- `computeLayout(nodes, edges, width, height)`
- `getNodeTraceTags(node)`
- `getNodeTraceLabel(node)`
- `formatTraceTag(tag)`
- `collectNodeKinds(nodes)`
- `collectEdgeKinds(edges)`
- `filterGraph(graph, filters, selectedNodeId, options)`
- `collectNeighborhoodScope(graph, centerNodeId, maxHops)`
- `isolateGraphToScope(graph, scope)`
- `buildSelectionPathFocus(graph, selectedNodeId, enabled, options)`
- `buildReadabilityWarnings(graph, options)`
- `evaluateReasoningGraph(snapshot)`

## Example

```ts
import { evaluateReasoningGraph, filterGraph, projectGraph, summarizeGraph } from '@restormel/graph-core';

const snapshot = projectGraph(retrievalResult);
const summary = summarizeGraph(snapshot);
const evaluation = evaluateReasoningGraph({
  graph: { nodes: [], edges: [], missingData: [] },
  outputs: []
});
const filtered = filterGraph(
  {
    nodes: [],
    edges: [],
    ghostNodes: [],
    ghostEdges: []
  },
  {
    search: '',
    phase: 'all',
    density: 'comfortable',
    nodeKinds: new Set(),
    edgeKinds: new Set(),
    showGhosts: true
  },
  null
);
```
