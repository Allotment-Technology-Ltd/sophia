import type {
  GraphKitEdgeKind,
  GraphKitFocusMode,
  GraphKitGraphViewModel,
  GraphKitNeighborhoodDepth,
  GraphKitNodeKind,
  GraphKitScopeSummary
} from '$lib/graph-kit/types';

export interface GraphKitPathFocus {
  nodeIds: string[];
  edges: Array<{ from: string; to: string }>;
}

export function reconcileKindSelection<T extends string>(
  current: Set<T>,
  available: Set<T>
): Set<T> {
  if (available.size === 0) return new Set<T>();
  if (current.size === 0) return new Set(available);

  const next = new Set<T>();
  for (const value of current) {
    if (available.has(value)) next.add(value);
  }

  return next.size > 0 ? next : new Set(available);
}

export function toggleKindSelection<T extends string>(
  current: Set<T>,
  value: T,
  fallback: Set<T>
): Set<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next.size > 0 ? next : new Set(fallback);
}

export function buildSelectionPathFocus(
  graph: GraphKitGraphViewModel,
  selectedNodeId: string | null,
  enabled: boolean
): GraphKitPathFocus {
  if (!enabled || !selectedNodeId) {
    return { nodeIds: [], edges: [] };
  }

  const edges = graph.edges
    .filter(
      (edge) =>
        (edge.from === selectedNodeId || edge.to === selectedNodeId) &&
        ['supports', 'contradicts', 'unresolved', 'cites', 'retrieved-from'].includes(edge.kind)
    )
    .map((edge) => ({ from: edge.from, to: edge.to }));

  const nodeIds = new Set<string>([selectedNodeId]);
  for (const edge of edges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }

  return { nodeIds: [...nodeIds], edges };
}

export function mergePathFocuses(...paths: GraphKitPathFocus[]): GraphKitPathFocus {
  const nodeIds = new Set<string>();
  const edgeMap = new Map<string, { from: string; to: string }>();

  for (const path of paths) {
    for (const nodeId of path.nodeIds) nodeIds.add(nodeId);
    for (const edge of path.edges) {
      edgeMap.set(`${edge.from}:${edge.to}`, edge);
    }
  }

  return {
    nodeIds: [...nodeIds],
    edges: [...edgeMap.values()]
  };
}

export function buildFocusSummary(params: {
  focusMode: GraphKitFocusMode;
  scopeNodeIds: string[];
  scopeEdgeIds: string[];
  totalNodes: number;
  totalEdges: number;
}): GraphKitScopeSummary {
  return {
    active: params.focusMode !== 'global' && params.scopeNodeIds.length > 0,
    visibleNodes: params.scopeNodeIds.length,
    totalNodes: params.totalNodes,
    visibleEdges: params.scopeEdgeIds.length,
    totalEdges: params.totalEdges
  };
}

export function buildReadabilityWarnings(graph: GraphKitGraphViewModel): string[] {
  const warnings: string[] = [];
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const sourceCount = graph.nodes.filter((node) => node.kind === 'source').length;
  const crossSourceEdgeCount = graph.edges.filter(
    (edge) => edge.kind !== 'contains' && edge.kind !== 'retrieved-from'
  ).length;

  if (nodeCount >= 36) {
    warnings.push('Orbital v1 starts to lose global readability once roughly 36+ visible nodes compete for label space.');
  }
  if (edgeCount >= Math.max(nodeCount * 2, 24)) {
    warnings.push('Dense relation overlays create heavy edge crossings; local focus or isolation is recommended.');
  }
  if (sourceCount <= 1 && nodeCount >= 18) {
    warnings.push('When many claims share little source structure, the current source-centric layout collapses toward the center.');
  }
  if (crossSourceEdgeCount >= 18) {
    warnings.push('Cross-source reasoning links are only weakly clustered today, so support and contradiction paths become harder to trace.');
  }

  return warnings;
}

export function defaultNeighborhoodDepth(): GraphKitNeighborhoodDepth {
  return 1;
}

export function sortNodeKinds(kinds: Set<GraphKitNodeKind>): GraphKitNodeKind[] {
  return [...kinds].sort();
}

export function sortEdgeKinds(kinds: Set<GraphKitEdgeKind>): GraphKitEdgeKind[] {
  return [...kinds].sort();
}
