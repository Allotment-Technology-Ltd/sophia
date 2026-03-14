export interface WorkspaceGraphLikeNode<
  NodeKind extends string = string,
  Phase extends string = string
> {
  id: string;
  kind: NodeKind;
  phase?: Phase;
  searchText: string;
}

export interface WorkspaceGraphLikeEdge<
  EdgeKind extends string = string,
  Phase extends string = string
> {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  phase?: Phase;
}

export interface WorkspaceGhostLikeNode {
  anchorNodeId?: string;
}

export interface WorkspaceGhostLikeEdge {
  from: string;
  to: string;
}

export interface WorkspaceGraphLike<
  Node extends WorkspaceGraphLikeNode = WorkspaceGraphLikeNode,
  Edge extends WorkspaceGraphLikeEdge = WorkspaceGraphLikeEdge,
  GhostNode extends WorkspaceGhostLikeNode = WorkspaceGhostLikeNode,
  GhostEdge extends WorkspaceGhostLikeEdge = WorkspaceGhostLikeEdge
> {
  nodes: Node[];
  edges: Edge[];
  ghostNodes: GhostNode[];
  ghostEdges: GhostEdge[];
}

export interface WorkspaceGraphFilters<
  NodeKind extends string,
  EdgeKind extends string,
  Phase extends string
> {
  search: string;
  phase: 'all' | Phase;
  density: 'comfortable' | 'dense';
  nodeKinds: Set<NodeKind>;
  edgeKinds: Set<EdgeKind>;
  showGhosts: boolean;
}

export interface WorkspaceFocusScope {
  nodeIds: string[];
  edgeIds: string[];
}

export interface WorkspacePathFocus {
  nodeIds: string[];
  edges: Array<{ from: string; to: string }>;
}

export interface WorkspaceScopeSummary {
  active: boolean;
  visibleNodes: number;
  totalNodes: number;
  visibleEdges: number;
  totalEdges: number;
}

function setsEqual<T extends string>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

export function reconcileKindSelection<T extends string>(
  current: Set<T>,
  available: Set<T>
): Set<T> {
  if (available.size === 0) {
    return current.size === 0 ? current : new Set<T>();
  }
  if (current.size === 0) {
    return setsEqual(current, available) ? current : new Set(available);
  }

  const next = new Set<T>();
  for (const value of current) {
    if (available.has(value)) next.add(value);
  }

  if (next.size > 0) {
    return setsEqual(current, next) ? current : next;
  }

  return setsEqual(current, available) ? current : new Set(available);
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

export function collectNodeKinds<Node extends { kind: string }>(
  nodes: Node[]
): Set<Node['kind']> {
  return new Set(nodes.map((node) => node.kind));
}

export function collectEdgeKinds<Edge extends { kind: string }>(
  edges: Edge[]
): Set<Edge['kind']> {
  return new Set(edges.map((edge) => edge.kind));
}

export function filterGraph<
  Node extends WorkspaceGraphLikeNode,
  Edge extends WorkspaceGraphLikeEdge,
  GhostNode extends WorkspaceGhostLikeNode,
  GhostEdge extends WorkspaceGhostLikeEdge,
  Graph extends WorkspaceGraphLike<Node, Edge, GhostNode, GhostEdge>
>(
  graph: Graph,
  filters: WorkspaceGraphFilters<Node['kind'], Edge['kind'], NonNullable<Node['phase']>>,
  selectedNodeId: string | null,
  options?: {
    comfortableHiddenEdgeKinds?: Edge['kind'][];
  }
): Graph {
  const search = filters.search.trim().toLowerCase();

  const nodeMatches = (node: Node): boolean => {
    if (filters.phase !== 'all' && node.phase && node.phase !== filters.phase) return false;
    if (!filters.nodeKinds.has(node.kind) && node.id !== selectedNodeId) return false;
    if (!search) return true;
    return node.searchText.toLowerCase().includes(search);
  };

  const matchedNodeIds = new Set(graph.nodes.filter(nodeMatches).map((node) => node.id));
  if (selectedNodeId) matchedNodeIds.add(selectedNodeId);

  let edges = graph.edges.filter((edge) => {
    if (!filters.edgeKinds.has(edge.kind)) return false;
    if (filters.phase !== 'all' && edge.phase && edge.phase !== filters.phase) return false;
    return matchedNodeIds.has(edge.from) && matchedNodeIds.has(edge.to);
  });

  if (filters.density === 'comfortable') {
    const hiddenKinds = new Set(options?.comfortableHiddenEdgeKinds ?? []);
    const logicalEdges = edges.filter((edge) => !hiddenKinds.has(edge.kind));
    if (logicalEdges.length > 0) edges = logicalEdges;
  }

  const visibleNodeIds = new Set<string>();
  for (const edge of edges) {
    visibleNodeIds.add(edge.from);
    visibleNodeIds.add(edge.to);
  }
  if (selectedNodeId) visibleNodeIds.add(selectedNodeId);

  const nodes = graph.nodes.filter((node) => {
    if (visibleNodeIds.size === 0) return nodeMatches(node);
    return visibleNodeIds.has(node.id) && nodeMatches(node);
  });

  const nodeIds = new Set(nodes.map((node) => node.id));

  return {
    ...graph,
    nodes,
    edges,
    ghostNodes: filters.showGhosts
      ? graph.ghostNodes.filter(
          (node) => !node.anchorNodeId || nodeIds.has(node.anchorNodeId)
        )
      : [],
    ghostEdges: filters.showGhosts
      ? graph.ghostEdges.filter(
          (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)
        )
      : []
  };
}

export function collectNeighborhoodScope<
  Edge extends WorkspaceGraphLikeEdge
>(
  graph: Pick<WorkspaceGraphLike<WorkspaceGraphLikeNode, Edge>, 'edges'>,
  centerNodeId: string | null,
  maxHops: number
): WorkspaceFocusScope {
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

export function isolateGraphToScope<
  Node extends WorkspaceGraphLikeNode,
  Edge extends WorkspaceGraphLikeEdge,
  GhostNode extends WorkspaceGhostLikeNode,
  GhostEdge extends WorkspaceGhostLikeEdge,
  Graph extends WorkspaceGraphLike<Node, Edge, GhostNode, GhostEdge>
>(
  graph: Graph,
  scope: WorkspaceFocusScope
): Graph {
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

export function buildSelectionPathFocus<
  Node extends WorkspaceGraphLikeNode,
  Edge extends WorkspaceGraphLikeEdge
>(
  graph: Pick<WorkspaceGraphLike<Node, Edge>, 'edges'>,
  selectedNodeId: string | null,
  enabled: boolean,
  options: {
    highlightEdgeKinds: Edge['kind'][];
  }
): WorkspacePathFocus {
  if (!enabled || !selectedNodeId) {
    return { nodeIds: [], edges: [] };
  }

  const highlightKinds = new Set(options.highlightEdgeKinds);
  const edges = graph.edges
    .filter(
      (edge) =>
        (edge.from === selectedNodeId || edge.to === selectedNodeId) &&
        highlightKinds.has(edge.kind)
    )
    .map((edge) => ({ from: edge.from, to: edge.to }));

  const nodeIds = new Set<string>([selectedNodeId]);
  for (const edge of edges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }

  return { nodeIds: [...nodeIds], edges };
}

export function mergePathFocuses(...paths: WorkspacePathFocus[]): WorkspacePathFocus {
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
  focusMode: string;
  scopeNodeIds: string[];
  scopeEdgeIds: string[];
  totalNodes: number;
  totalEdges: number;
}): WorkspaceScopeSummary {
  return {
    active: params.focusMode !== 'global' && params.scopeNodeIds.length > 0,
    visibleNodes: params.scopeNodeIds.length,
    totalNodes: params.totalNodes,
    visibleEdges: params.scopeEdgeIds.length,
    totalEdges: params.totalEdges
  };
}

export function buildReadabilityWarnings<
  Node extends { kind: string },
  Edge extends { kind: string }
>(
  graph: Pick<WorkspaceGraphLike<Node & WorkspaceGraphLikeNode, Edge & WorkspaceGraphLikeEdge>, 'nodes' | 'edges'>,
  options?: {
    sourceNodeKinds?: Node['kind'][];
    lowSourceThreshold?: number;
    crowdedNodeThreshold?: number;
    denseEdgeFloor?: number;
    structuralEdgeKinds?: Edge['kind'][];
  }
): string[] {
  const warnings: string[] = [];
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const sourceNodeKinds = new Set(options?.sourceNodeKinds ?? (['source'] as Node['kind'][]));
  const structuralEdgeKinds = new Set(
    options?.structuralEdgeKinds ?? (['contains', 'retrieved-from'] as Edge['kind'][])
  );
  const sourceCount = graph.nodes.filter((node) => sourceNodeKinds.has(node.kind)).length;
  const crossSourceEdgeCount = graph.edges.filter(
    (edge) => !structuralEdgeKinds.has(edge.kind)
  ).length;

  if (nodeCount >= (options?.crowdedNodeThreshold ?? 36)) {
    warnings.push('Orbital v1 starts to lose global readability once roughly 36+ visible nodes compete for label space.');
  }
  if (edgeCount >= Math.max(nodeCount * 2, options?.denseEdgeFloor ?? 24)) {
    warnings.push('Dense relation overlays create heavy edge crossings; local focus or isolation is recommended.');
  }
  if (sourceCount <= (options?.lowSourceThreshold ?? 1) && nodeCount >= 18) {
    warnings.push('When many claims share little source structure, the current source-centric layout collapses toward the center.');
  }
  if (crossSourceEdgeCount >= 18) {
    warnings.push('Cross-source reasoning links are only weakly clustered today, so support and contradiction paths become harder to trace.');
  }

  return warnings;
}
