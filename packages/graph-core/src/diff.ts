import type { GraphEdge, GraphSnapshot } from '@restormel/contracts';

export interface GraphDiff {
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  changedNodeIds: string[];
  changedEdgeIds: string[];
}

function edgeKey(edge: Pick<GraphEdge, 'from' | 'to' | 'type'>): string {
  return `${edge.from}:${edge.type}:${edge.to}`;
}

export function diffGraphs(before: GraphSnapshot, after: GraphSnapshot): GraphDiff {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(before.edges.map((edge) => [edgeKey(edge), edge]));
  const afterEdges = new Map(after.edges.map((edge) => [edgeKey(edge), edge]));

  const addedNodeIds = [...afterNodes.keys()].filter((id) => !beforeNodes.has(id));
  const removedNodeIds = [...beforeNodes.keys()].filter((id) => !afterNodes.has(id));
  const changedNodeIds = [...afterNodes.entries()]
    .filter(([id, node]) => beforeNodes.has(id) && JSON.stringify(beforeNodes.get(id)) !== JSON.stringify(node))
    .map(([id]) => id);

  const addedEdgeIds = [...afterEdges.keys()].filter((id) => !beforeEdges.has(id));
  const removedEdgeIds = [...beforeEdges.keys()].filter((id) => !afterEdges.has(id));
  const changedEdgeIds = [...afterEdges.entries()]
    .filter(([id, edge]) => beforeEdges.has(id) && JSON.stringify(beforeEdges.get(id)) !== JSON.stringify(edge))
    .map(([id]) => id);

  return {
    addedNodeIds,
    removedNodeIds,
    addedEdgeIds,
    removedEdgeIds,
    changedNodeIds,
    changedEdgeIds
  };
}
