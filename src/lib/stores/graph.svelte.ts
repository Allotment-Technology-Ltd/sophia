import type { GraphNode, GraphEdge, GraphSnapshotMeta } from '$lib/types/api';
import type { AnalysisPhase, Claim, RelationBundle } from '$lib/types/references';

type GraphLifecycle = 'idle' | 'loading' | 'ready' | 'degraded' | 'error';

const ALL_RELATION_TYPES: GraphEdge['type'][] = [
  'contains',
  'supports',
  'contradicts',
  'responds-to',
  'depends-on'
];

function createGraphStore() {
  let lifecycle = $state<GraphLifecycle>('idle');
  let error = $state<string | null>(null);
  let lastUpdatedAt = $state<number | null>(null);

  let rawNodes = $state<GraphNode[]>([]);
  let rawEdges = $state<GraphEdge[]>([]);
  let nodes = $state<GraphNode[]>([]);
  let edges = $state<GraphEdge[]>([]);

  let snapshotVersion = $state<number>(1);
  let snapshotMeta = $state<GraphSnapshotMeta | null>(null);

  let selectedNodeId = $state<string | null>(null);
  let highlightedNodeIds = $state<Set<string>>(new Set());
  let relationFilter = $state<Set<GraphEdge['type']>>(new Set(ALL_RELATION_TYPES));

  function setLifecycle(next: GraphLifecycle, reason?: string) {
    lifecycle = next;
    if (next === 'error') error = reason ?? 'Graph store failed to update.';
    if (next !== 'error') error = null;
  }

  function recomputeDerivedGraph() {
    const filteredEdges = rawEdges.filter((edge) => relationFilter.has(edge.type));
    const visibleNodeIds = new Set<string>();

    for (const edge of filteredEdges) {
      visibleNodeIds.add(edge.from);
      visibleNodeIds.add(edge.to);
    }

    const filteredNodes = rawNodes.filter((node) => {
      if (node.type === 'source') return true;
      return visibleNodeIds.has(node.id);
    });

    nodes = filteredNodes;
    edges = filteredEdges;
  }

  function setGraph(
    newNodes: GraphNode[],
    newEdges: GraphEdge[],
    meta?: GraphSnapshotMeta,
    version = 1
  ) {
    if (version < snapshotVersion) {
      // Ignore stale out-of-order snapshots.
      return;
    }

    const isPartialPayload = !Array.isArray(newNodes) || !Array.isArray(newEdges);
    if (isPartialPayload) {
      setLifecycle('error', 'graph_snapshot payload malformed');
      return;
    }

    rawNodes = newNodes;
    rawEdges = newEdges;
    snapshotMeta = meta ?? null;
    snapshotVersion = version;
    lastUpdatedAt = Date.now();
    recomputeDerivedGraph();

    if (newNodes.length === 0 || meta?.retrievalDegraded) {
      const reason = meta?.retrievalDegradedReason ?? (newNodes.length === 0 ? 'no_nodes' : 'retrieval_degraded');
      setLifecycle('degraded');
      if (reason) error = reason;
      return;
    }
    setLifecycle('ready');
  }

  function applyRelationFilter(types: GraphEdge['type'][]) {
    relationFilter = new Set(types);
    recomputeDerivedGraph();
  }

  function resetFilters() {
    relationFilter = new Set(ALL_RELATION_TYPES);
    recomputeDerivedGraph();
  }

  function selectNode(nodeId: string | null) {
    selectedNodeId = nodeId;
    if (!nodeId) {
      highlightedNodeIds = new Set();
      return;
    }
    const neighbors = new Set<string>([nodeId]);
    for (const edge of edges) {
      if (edge.from === nodeId) neighbors.add(edge.to);
      if (edge.to === nodeId) neighbors.add(edge.from);
    }
    highlightedNodeIds = neighbors;
  }

  function setLoading() {
    setLifecycle('loading');
  }

  function setDegraded(reason?: string) {
    setLifecycle('degraded');
    if (reason) error = reason;
  }

  function reset() {
    lifecycle = 'idle';
    error = null;
    rawNodes = [];
    rawEdges = [];
    nodes = [];
    edges = [];
    snapshotMeta = null;
    snapshotVersion = 1;
    selectedNodeId = null;
    highlightedNodeIds = new Set();
    relationFilter = new Set(ALL_RELATION_TYPES);
  }

  function addFromClaims(phase: AnalysisPhase, newClaims: Claim[], newRelations: RelationBundle[]) {
    const nextNodes = [...rawNodes];
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

    const nextEdges = [...rawEdges];
    const edgeKeys = new Set(nextEdges.map((edge) => `${edge.from}|${edge.to}|${edge.type}`));

    for (const bundle of newRelations) {
      for (const rel of bundle.relations) {
        const key = `${bundle.claimId}|${rel.target}|${rel.type}`;
        if (edgeKeys.has(key)) continue;
        nextEdges.push({
          from: bundle.claimId,
          to: rel.target,
          type: rel.type,
          phaseOrigin: phase
        });
        edgeKeys.add(key);
      }
    }

    rawNodes = nextNodes;
    rawEdges = nextEdges;
    recomputeDerivedGraph();
  }

  return {
    get lifecycle() { return lifecycle; },
    get error() { return error; },
    get rawNodes() { return rawNodes; },
    get rawEdges() { return rawEdges; },
    get nodes() { return nodes; },
    get edges() { return edges; },
    get selectedNodeId() { return selectedNodeId; },
    get highlightedNodeIds() { return highlightedNodeIds; },
    get relationFilter() { return relationFilter; },
    get snapshotMeta() { return snapshotMeta; },
    get snapshotVersion() { return snapshotVersion; },
    get lastUpdatedAt() { return lastUpdatedAt; },
    setGraph,
    setLoading,
    setDegraded,
    applyRelationFilter,
    resetFilters,
    addFromClaims,
    selectNode,
    reset
  };
}

export const graphStore = createGraphStore();
