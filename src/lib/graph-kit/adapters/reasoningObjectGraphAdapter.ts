import type {
  ReasoningObjectSnapshot,
  ReasoningObjectTraceEventSource
} from '@restormel/contracts/reasoning-object';
import type {
  GraphKitEdge,
  GraphKitEvaluationFinding,
  GraphKitEvaluationSummary,
  GraphKitGhostEdge,
  GraphKitGhostNode,
  GraphKitGraphViewModel,
  GraphKitNode,
  GraphKitTraceEvent,
  GraphKitTracePlaybackDescriptor
} from '$lib/graph-kit/types';

function toTraceSource(source: ReasoningObjectTraceEventSource): GraphKitTraceEvent['source'] {
  switch (source) {
    case 'run-stream':
      return 'sophia-stream';
    case 'snapshot-meta':
      return 'snapshot-meta';
    case 'graph-derived':
      return 'graph-derived';
    case 'placeholder':
      return 'placeholder';
  }
}

export function adaptReasoningNodeToGraphKit(
  node: ReasoningObjectSnapshot['graph']['nodes'][number]
): GraphKitNode {
  // Rendering boundary:
  // the reasoning-object snapshot is the compiled graph contract, while Graph Kit
  // remains the UI-facing view model for the current workspace shell.
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    preview: node.preview,
    phase: node.phase,
    status: node.status,
    confidence: node.confidence,
    evidenceStrength: node.evidenceStrength,
    sourceLabel: node.sourceLabel,
    isSeed: node.isSeed,
    isTraversed: node.isTraversed,
    tags: node.tags,
    searchText: node.searchText,
    metadata: {
      rawType: node.metadata.rawType,
      domain: node.metadata.domain,
      sourceTitle: node.metadata.sourceTitle,
      traversalDepth: node.metadata.traversalDepth,
      relevance: node.metadata.relevance,
      confidenceBand: node.metadata.confidenceBand,
      passOrigin: node.metadata.passOrigin,
      derivedFromIds: node.metadata.derivedFromIds,
      unresolvedTensionId: node.metadata.unresolvedTensionId,
      provenanceId: node.metadata.provenanceId,
      noveltyScore: node.metadata.noveltyScore,
      taxonomyReason: node.classification.reason,
      taxonomyConfidence: node.classification.confidence,
      missingSignals: node.classification.missingSignals,
      extra: node.metadata.extra as GraphKitNode['metadata']['extra']
    },
    provenance: node.provenance,
    evidence: node.evidence
  };
}

export function adaptReasoningEdgeToGraphKit(
  edge: ReasoningObjectSnapshot['graph']['edges'][number]
): GraphKitEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    phase: edge.phase,
    status: edge.status,
    confidence: edge.confidence,
    rationale: edge.rationale,
    evidenceCount: edge.evidenceCount,
    metadata: {
      passOrigin: edge.metadata.passOrigin,
      depthLevel: edge.metadata.depthLevel,
      derivedFromIds: edge.metadata.derivedFromIds,
      unresolvedTensionId: edge.metadata.unresolvedTensionId,
      provenanceId: edge.metadata.provenanceId,
      evidenceSources: edge.metadata.evidenceSources,
      extra: edge.metadata.extra as GraphKitEdge['metadata']['extra']
    },
    provenance: edge.provenance,
    evidence: edge.evidence
  };
}

export function adaptReasoningTraceToGraphKit(
  events: ReasoningObjectSnapshot['trace'],
  missingCapabilities: string[]
): GraphKitTraceEvent[] {
  return events.map((event) => ({
    id: event.id,
    kind: event.kind,
    title: event.title,
    summary: event.summary,
    phase: event.phase,
    status: event.status,
    source: toTraceSource(event.source),
    sequence: event.sequence,
    timestamp: event.timestamp,
    facts: event.facts,
    focus: event.focus,
    playback: {
      replayable: false,
      mode: event.kind === 'snapshot-captured' ? 'snapshot-only' : 'event-focus',
      missingCapabilities: [...missingCapabilities]
    }
  }));
}

export function adaptReasoningSnapshotToGraphKit(params: {
  snapshot: ReasoningObjectSnapshot;
  ghostNodes: GraphKitGhostNode[];
  ghostEdges: GraphKitGhostEdge[];
  missingCapabilities: string[];
}): {
  graph: GraphKitGraphViewModel;
  traceEvents: GraphKitTraceEvent[];
  playback: GraphKitTracePlaybackDescriptor;
} {
  return {
    graph: {
      nodes: params.snapshot.graph.nodes.map(adaptReasoningNodeToGraphKit),
      edges: params.snapshot.graph.edges.map(adaptReasoningEdgeToGraphKit),
      ghostNodes: params.ghostNodes,
      ghostEdges: params.ghostEdges,
      compareResult: null,
      graphEvaluation:
        params.snapshot.evaluation?.graphSummary
          ? {
              summary: params.snapshot.evaluation.graphSummary as GraphKitEvaluationSummary,
              findings: (params.snapshot.evaluation.graphFindings ?? []) as GraphKitEvaluationFinding[]
            }
          : null,
      missingData: params.snapshot.graph.missingData
    },
    traceEvents: adaptReasoningTraceToGraphKit(params.snapshot.trace, params.missingCapabilities),
    playback: {
      mode: 'event-focus',
      canReplay: false,
      hasEventSelection: params.snapshot.trace.length > 0,
      missingCapabilities: [...params.missingCapabilities],
      todo: [
        'TODO: playback controls',
        'TODO: persisted graph frames for scrubbing',
        'TODO: provenance drawer integration'
      ]
    }
  };
}
