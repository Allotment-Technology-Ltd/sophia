import type { GraphEdge, GraphSnapshot } from '@restormel/contracts';

export interface GraphSummary {
  nodeCount: number;
  edgeCount: number;
  ghostNodeCount: number;
  ghostEdgeCount: number;
  seedNodeCount: number;
  traversedNodeCount: number;
  nodeTypeCounts: Record<string, number>;
  edgeTypeCounts: Partial<Record<GraphEdge['type'], number>>;
  contextSufficiency: 'strong' | 'moderate' | 'sparse' | undefined;
  retrievalDegraded: boolean;
}

export function summarizeGraph(snapshot: GraphSnapshot): GraphSummary {
  const nodeTypeCounts = snapshot.nodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    return counts;
  }, {});

  const edgeTypeCounts = snapshot.edges.reduce<Partial<Record<GraphEdge['type'], number>>>((counts, edge) => {
    counts[edge.type] = (counts[edge.type] ?? 0) + 1;
    return counts;
  }, {});

  return {
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    ghostNodeCount: snapshot.meta?.rejectedNodes?.length ?? 0,
    ghostEdgeCount: snapshot.meta?.rejectedEdges?.length ?? 0,
    seedNodeCount: snapshot.meta?.seedNodeIds?.length ?? 0,
    traversedNodeCount: snapshot.meta?.traversedNodeIds?.length ?? 0,
    nodeTypeCounts,
    edgeTypeCounts,
    contextSufficiency: snapshot.meta?.contextSufficiency,
    retrievalDegraded: snapshot.meta?.retrievalDegraded ?? false
  };
}
