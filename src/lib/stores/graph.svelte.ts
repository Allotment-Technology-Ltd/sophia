import type { GraphNode, GraphEdge } from '$lib/types/api';

function createGraphStore() {
  let nodes = $state<GraphNode[]>([]);
  let edges = $state<GraphEdge[]>([]);
  let selectedNodeId = $state<string | null>(null);
  let highlightedNodeIds = $state<Set<string>>(new Set());

  function setGraph(newNodes: GraphNode[], newEdges: GraphEdge[]) {
    console.log('[GraphStore] setGraph called:', { nodeCount: newNodes.length, edgeCount: newEdges.length });
    nodes = newNodes;
    edges = newEdges;
  }

  function selectNode(nodeId: string | null) {
    if (nodeId === selectedNodeId) {
      // Second click: open detail
      selectedNodeId = null;
      highlightedNodeIds = new Set();
      return 'detail';
    } else {
      // First click: highlight neighborhood
      selectedNodeId = nodeId;
      if (nodeId) {
        const neighbors = new Set<string>([nodeId]);
        edges.forEach(e => {
          if (e.from === nodeId) neighbors.add(e.to);
          if (e.to === nodeId) neighbors.add(e.from);
        });
        highlightedNodeIds = neighbors;
      } else {
        highlightedNodeIds = new Set();
      }
      return 'highlight';
    }
  }

  function reset() {
    nodes = [];
    edges = [];
    selectedNodeId = null;
    highlightedNodeIds = new Set();
  }

  return {
    get nodes() { return nodes; },
    get edges() { return edges; },
    get selectedNodeId() { return selectedNodeId; },
    get highlightedNodeIds() { return highlightedNodeIds; },
    setGraph,
    selectNode,
    reset,
  };
}

export const graphStore = createGraphStore();
