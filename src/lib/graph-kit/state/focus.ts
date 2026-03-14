import type { GraphKitGraphViewModel } from '$lib/graph-kit/types';

export interface GraphKitFocusScope {
  nodeIds: string[];
  edgeIds: string[];
}

export function collectNeighborhoodScope(
  graph: GraphKitGraphViewModel,
  centerNodeId: string | null,
  maxHops: number
): GraphKitFocusScope {
  if (!centerNodeId || maxHops < 0) {
    return { nodeIds: [], edgeIds: [] };
  }

  const visited = new Set<string>([centerNodeId]);
  const frontier = new Set<string>([centerNodeId]);
  const edgeIds = new Set<string>();

  for (let hop = 0; hop < maxHops; hop += 1) {
    const nextFrontier = new Set<string>();

    for (const edge of graph.edges) {
      const fromInFrontier = frontier.has(edge.from);
      const toInFrontier = frontier.has(edge.to);

      if (!fromInFrontier && !toInFrontier) continue;

      edgeIds.add(edge.id);

      if (fromInFrontier && !visited.has(edge.to)) {
        visited.add(edge.to);
        nextFrontier.add(edge.to);
      }

      if (toInFrontier && !visited.has(edge.from)) {
        visited.add(edge.from);
        nextFrontier.add(edge.from);
      }
    }

    if (nextFrontier.size === 0) break;
    frontier.clear();
    for (const nodeId of nextFrontier) frontier.add(nodeId);
  }

  return {
    nodeIds: [...visited],
    edgeIds: [...edgeIds]
  };
}

export function isolateGraphToScope(
  graph: GraphKitGraphViewModel,
  scope: GraphKitFocusScope
): GraphKitGraphViewModel {
  if (scope.nodeIds.length === 0) return graph;

  const nodeIdSet = new Set(scope.nodeIds);
  const edgeIdSet = new Set(scope.edgeIds);

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => nodeIdSet.has(node.id)),
    edges: graph.edges.filter((edge) => edgeIdSet.has(edge.id)),
    ghostNodes: graph.ghostNodes.filter(
      (node) => !node.anchorNodeId || nodeIdSet.has(node.anchorNodeId)
    ),
    ghostEdges: graph.ghostEdges.filter(
      (edge) => nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to)
    )
  };
}
