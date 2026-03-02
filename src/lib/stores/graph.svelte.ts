import type { GraphNode, GraphEdge } from '$lib/types/api';
import type { AnalysisPhase, Claim, RelationBundle } from '$lib/types/references';

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

  function addFromClaims(phase: AnalysisPhase, newClaims: Claim[], newRelations: RelationBundle[]) {
    const nextNodes = [...nodes];
    const existingNodeIds = new Set(nextNodes.map((node) => node.id));

    for (const claim of newClaims) {
      if (existingNodeIds.has(claim.id)) continue;
      nextNodes.push({
        id: claim.id,
        type: 'claim',
        label: claim.text,
        phase
      });
      existingNodeIds.add(claim.id);
    }

    const nextEdges = [...edges];
    const edgeKeys = new Set(nextEdges.map((edge) => `${edge.from}|${edge.to}|${edge.type}`));

    for (const bundle of newRelations) {
      for (const rel of bundle.relations) {
        const key = `${bundle.claimId}|${rel.target}|${rel.type}`;
        if (edgeKeys.has(key)) continue;
        nextEdges.push({
          from: bundle.claimId,
          to: rel.target,
          type: rel.type
        });
        edgeKeys.add(key);
      }
    }

    nodes = nextNodes;
    edges = nextEdges;
  }

  return {
    get nodes() { return nodes; },
    get edges() { return edges; },
    get selectedNodeId() { return selectedNodeId; },
    get highlightedNodeIds() { return highlightedNodeIds; },
    setGraph,
    addFromClaims,
    selectNode,
    reset,
  };
}

export const graphStore = createGraphStore();
