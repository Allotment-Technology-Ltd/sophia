import type {
  GraphKitEdge,
  GraphKitEdgeKind,
  GraphKitInspectorPayload,
  GraphKitInspectorRelationItem,
  GraphKitNode,
  GraphKitNodeKind,
  GraphKitTraceEvent,
  GraphKitWorkspaceData,
  GraphKitWorkspaceFilters
} from '$lib/graph-kit/types';

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return Number.isInteger(value) ? `${value}` : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === null || value === undefined || value === '') return 'n/a';
  return String(value);
}

export function collectRelationKinds(edges: GraphKitEdge[]): Set<GraphKitEdgeKind> {
  return new Set(edges.map((edge) => edge.kind));
}

// Prefer the "edge" terminology at the Graph Kit boundary. Keep the old
// function as a compatibility alias until any downstream imports are cleaned up.
export const collectEdgeKinds = collectRelationKinds;

export function collectNodeKinds(nodes: GraphKitNode[]): Set<GraphKitNodeKind> {
  return new Set(nodes.map((node) => node.kind));
}

export function filterWorkspaceData(
  workspace: GraphKitWorkspaceData,
  filters: GraphKitWorkspaceFilters,
  selectedNodeId: string | null
): GraphKitWorkspaceData {
  const search = filters.search.trim().toLowerCase();

  const nodeMatches = (node: GraphKitNode): boolean => {
    if (filters.phase !== 'all' && node.phase && node.phase !== filters.phase) return false;
    if (!filters.nodeKinds.has(node.kind) && node.id !== selectedNodeId) return false;
    if (!search) return true;
    return node.searchText.toLowerCase().includes(search);
  };

  const matchedNodeIds = new Set(workspace.graph.nodes.filter(nodeMatches).map((node) => node.id));
  if (selectedNodeId) matchedNodeIds.add(selectedNodeId);

  let edges = workspace.graph.edges.filter((edge) => {
    if (!filters.edgeKinds.has(edge.kind)) return false;
    if (filters.phase !== 'all' && edge.phase && edge.phase !== filters.phase) return false;
    return matchedNodeIds.has(edge.from) && matchedNodeIds.has(edge.to);
  });

  if (filters.density === 'comfortable') {
    const logicalEdges = edges.filter((edge) => edge.kind !== 'contains');
    if (logicalEdges.length > 0) edges = logicalEdges;
  }

  const visibleNodeIds = new Set<string>();
  for (const edge of edges) {
    visibleNodeIds.add(edge.from);
    visibleNodeIds.add(edge.to);
  }
  if (selectedNodeId) visibleNodeIds.add(selectedNodeId);

  const nodes = workspace.graph.nodes.filter((node) => {
    if (visibleNodeIds.size === 0) return nodeMatches(node);
    return visibleNodeIds.has(node.id) && nodeMatches(node);
  });

  const nodeIds = new Set(nodes.map((node) => node.id));

  return {
    ...workspace,
    graph: {
      ...workspace.graph,
      nodes,
      edges,
      ghostNodes: filters.showGhosts
        ? workspace.graph.ghostNodes.filter(
            (node) => !node.anchorNodeId || nodeIds.has(node.anchorNodeId)
          )
        : [],
      ghostEdges: filters.showGhosts
        ? workspace.graph.ghostEdges.filter(
            (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)
          )
        : []
    }
  };
}

export function buildWorkspaceInspectorPayload(
  workspace: GraphKitWorkspaceData
): GraphKitInspectorPayload {
  return {
    target: 'workspace',
    title: workspace.summary.title,
    subtitle: workspace.summary.subtitle,
    summary:
      'Select a node to inspect taxonomy mapping, provenance availability, evidence references, and connected reasoning.',
    sections: [
      {
        title: 'Run Summary',
        rows: workspace.summary.metrics.map((metric) => ({
          label: metric.label,
          value: metric.value
        }))
      },
      {
        title: 'Missing Data',
        rows:
          workspace.graph.missingData.length > 0
            ? workspace.graph.missingData.map((note, index) => ({
                label: `gap ${index + 1}`,
                value: note
              }))
            : [{ label: 'status', value: 'No known modeling gaps recorded' }]
      }
    ],
    validationNotes: workspace.graph.missingData,
    todo: [
      'TODO: provenance drawer integration',
      'TODO: compare mode entry point'
    ]
  };
}

export function buildNodeInspectorPayload(
  workspace: GraphKitWorkspaceData,
  nodeId: string
): GraphKitInspectorPayload | null {
  const node = workspace.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;

  const connectedEdges = workspace.graph.edges.filter(
    (edge) => edge.from === nodeId || edge.to === nodeId
  );
  const connectedRows = connectedEdges.slice(0, 8).map((edge) => {
    const relatedId = edge.from === nodeId ? edge.to : edge.from;
    const related = workspace.graph.nodes.find((candidate) => candidate.id === relatedId);
    return {
      label: edge.kind,
      value: related ? related.title : relatedId
    };
  });

  function toRelationItem(edge: GraphKitEdge, kind: 'support' | 'contradiction'): GraphKitInspectorRelationItem {
    const relatedId = edge.from === nodeId ? edge.to : edge.from;
    const related = workspace.graph.nodes.find((candidate) => candidate.id === relatedId);
    return {
      id: edge.id,
      title: related ? related.title : relatedId,
      kind,
      confidence: edge.confidence,
      rationale: edge.rationale
    };
  }

  const supportRelations = connectedEdges
    .filter((edge) => edge.kind === 'supports' || edge.kind === 'cites' || edge.kind === 'retrieved-from')
    .map((edge) => toRelationItem(edge, 'support'));

  const contradictionRelations = connectedEdges
    .filter((edge) => edge.kind === 'contradicts' || edge.kind === 'unresolved')
    .map((edge) => toRelationItem(edge, 'contradiction'));

  const metadataRows = [
    { label: 'raw type', value: formatValue(node.metadata.rawType) },
    { label: 'domain', value: formatValue(node.metadata.domain) },
    { label: 'source title', value: formatValue(node.metadata.sourceTitle) },
    { label: 'traversal depth', value: formatValue(node.metadata.traversalDepth) },
    { label: 'pass origin', value: formatValue(node.metadata.passOrigin) },
    { label: 'derived from', value: formatValue(node.metadata.derivedFromIds) },
    { label: 'provenance id', value: formatValue(node.metadata.provenanceId) },
    { label: 'unresolved tension', value: formatValue(node.metadata.unresolvedTensionId) }
  ];

  const provenanceRows =
    node.provenance.length > 0
      ? node.provenance.map((item) => ({
          label: item.label,
          value: item.value
        }))
      : [{ label: 'provenance', value: 'No structured provenance item available in this snapshot' }];

  const evidenceRows =
    node.evidence.length > 0
      ? node.evidence.map((item) => ({
          label: item.label,
          value: item.summary
        }))
      : [{ label: 'evidence', value: 'No explicit evidence item available for this node' }];

  return {
    target: 'node',
    title: node.title,
    subtitle: `${node.kind}${node.phase ? ` • ${node.phase}` : ''}`,
    badges: node.tags,
    summary: node.preview ?? 'No preview available for this node yet.',
    confidence: node.confidence,
    sourceBadges: [
      ...(node.sourceLabel ? [node.sourceLabel] : []),
      ...node.evidence.map((item) => item.sourceTitle).filter((value): value is string => Boolean(value))
    ].filter((value, index, array) => array.indexOf(value) === index),
    sections: [
      {
        title: 'Reasoning Signals',
        rows: [
          { label: 'status', value: node.status },
          { label: 'confidence', value: formatValue(node.confidence) },
          { label: 'evidence strength', value: formatValue(node.evidenceStrength) },
          { label: 'source', value: formatValue(node.sourceLabel) }
        ]
      },
      {
        title: 'Taxonomy Mapping',
        rows: [
          { label: 'target kind', value: node.kind },
          { label: 'reason', value: node.metadata.taxonomyReason },
          { label: 'confidence', value: node.metadata.taxonomyConfidence },
          {
            label: 'missing signals',
            value:
              node.metadata.missingSignals.length > 0
                ? node.metadata.missingSignals.join(' | ')
                : 'none'
          }
        ]
      },
      {
        title: 'Provenance',
        rows: provenanceRows
      },
      {
        title: 'Evidence',
        rows: evidenceRows
      },
      {
        title: 'Metadata',
        rows: metadataRows
      },
      {
        title: 'Connected Reasoning',
        rows:
          connectedRows.length > 0
            ? connectedRows
            : [{ label: 'connections', value: 'No visible connections in the current filter scope' }]
      }
    ],
    provenance: node.provenance,
    evidence: node.evidence,
    supportRelations,
    contradictionRelations,
    validationNotes: [
      ...node.metadata.missingSignals,
      ...(node.provenance.length === 0 ? ['No structured provenance payload is available for this node yet.'] : []),
      ...(supportRelations.length === 0 && contradictionRelations.length === 0
        ? ['No explicit support or contradiction relations are visible under the current filters.']
        : [])
    ],
    actions: [{ id: 'open-references', label: 'Open In References' }],
    todo: [
      'TODO: playback-linked inspector state',
      'TODO: provenance drawer for evidence excerpts',
      'TODO: validation checks and compare overlays'
    ]
  };
}

export function filterTraceEvents(
  events: GraphKitTraceEvent[],
  phase: GraphKitWorkspaceFilters['phase']
): GraphKitTraceEvent[] {
  if (phase === 'all') return events;
  return events.filter((event) => !event.phase || event.phase === phase);
}
