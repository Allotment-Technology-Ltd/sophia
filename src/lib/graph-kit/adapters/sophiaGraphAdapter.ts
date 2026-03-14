import type {
  EnrichmentStatusEvent,
  GraphEdge,
  GraphGhostEdge,
  GraphGhostNode,
  GraphNode,
  GraphSnapshotMeta
} from '$lib/types/api';
import type { AnalysisPhase, Claim, RelationBundle } from '$lib/types/references';
import { getNodeTraceTags } from '$lib/utils/graphTrace';
import type {
  GraphKitClassificationConfidence,
  GraphKitCompareResult,
  GraphKitEdge,
  GraphKitEdgeKind,
  GraphKitEntityStatus,
  GraphKitEvidenceItem,
  GraphKitGhostEdge,
  GraphKitGhostNode,
  GraphKitGraphViewModel,
  GraphKitNode,
  GraphKitNodeKind,
  GraphKitPhase,
  GraphKitProvenanceItem,
  GraphKitTraceEventFocus,
  GraphKitTraceEvent,
  GraphKitTracePlaybackDescriptor,
  GraphKitWorkspaceData
} from '$lib/graph-kit/types';
import type { ReasoningEvaluation } from '$lib/types/verification';

const PHASE_DEPTH_LEVEL: Record<AnalysisPhase, number> = {
  analysis: 1,
  critique: 2,
  synthesis: 3
};

const PLAYBACK_MISSING_CAPABILITIES = [
  'Per-event graph frames are not persisted; only the latest graph snapshot is available in the workspace.',
  'Pass-level timestamps are incomplete, so scrubbing cannot yet replay the real order and duration of reasoning steps.',
  'Historical run-event streams are cached elsewhere in SOPHIA but are not yet normalized into a package-ready trace contract.'
] as const;

interface SophiaTraceContext {
  queryText?: string | null;
  finalOutputText?: string | null;
  reasoningQuality?: ReasoningEvaluation | null;
  constitutionDeltas?: Array<{
    pass: 'analysis' | 'critique' | 'synthesis';
    introduced_violations: string[];
    resolved_violations: string[];
    unresolved_violations: string[];
    overall_compliance: 'pass' | 'partial' | 'fail';
  }> | null;
}

function edgeId(edge: Pick<GraphEdge, 'from' | 'to' | 'type'>): string {
  return `${edge.from}:${edge.type}:${edge.to}`;
}

function toEntityStatus(
  conflictStatus?: GraphNode['conflict_status'] | GraphEdge['conflict_status']
): GraphKitEntityStatus {
  switch (conflictStatus) {
    case 'resolved':
      return 'verified';
    case 'unresolved':
      return 'unresolved';
    case 'contested':
      return 'contradicted';
    default:
      return 'default';
  }
}

function toEdgeKind(edge: GraphEdge): GraphKitEdgeKind {
  return edge.type;
}

function confidenceBandFromValue(value?: number): 'high' | 'medium' | 'low' | undefined {
  if (typeof value !== 'number') return undefined;
  if (value >= 0.85) return 'high';
  if (value >= 0.65) return 'medium';
  return 'low';
}

function confidenceFromBand(band?: 'high' | 'medium' | 'low'): number | undefined {
  if (!band) return undefined;
  if (band === 'high') return 0.9;
  if (band === 'medium') return 0.65;
  return 0.4;
}

function makeSearchText(node: GraphNode): string {
  return [
    node.label,
    node.type,
    node.phase,
    node.domain,
    node.sourceTitle,
    ...(node.derived_from ?? [])
  ]
    .filter(Boolean)
    .join(' ');
}

function mapSophiaNodeKind(node: GraphNode): {
  kind: GraphKitNodeKind;
  confidence: GraphKitClassificationConfidence;
  reason: string;
  missingSignals: string[];
} {
  if (node.type === 'source') {
    return {
      kind: 'source',
      confidence: 'high',
      reason: 'SOPHIA emits explicit source container nodes in the current graph schema.',
      missingSignals: []
    };
  }

  if (node.phase === 'synthesis') {
    return {
      kind: 'synthesis',
      confidence: 'medium',
      reason: 'SOPHIA synthesis-pass claim nodes are currently the closest match to higher-order merged reasoning states.',
      missingSignals: ['No explicit conclusion vs synthesis split exists in current snapshot data.']
    };
  }

  if (node.conflict_status === 'contested' || node.unresolved_tension_id) {
    return {
      kind: 'contradiction',
      confidence: 'medium',
      reason: 'Conflict markers and unresolved tension IDs are the strongest current signal for contradiction-like nodes.',
      missingSignals: ['SOPHIA does not yet emit explicit contradiction nodes; this is inferred from claim state.']
    };
  }

  return {
    kind: 'claim',
    confidence: 'high',
    reason: 'Current non-source graph nodes in SOPHIA are emitted as claims.',
    missingSignals: [
      'No explicit evidence node type is emitted yet.',
      'No explicit inference step node type is emitted yet.',
      'No explicit query node is carried in the graph snapshot.'
    ]
  };
}

function buildNodeProvenance(node: GraphNode): GraphKitProvenanceItem[] {
  if (!node.provenance_id) return [];
  return [
    {
      id: node.provenance_id,
      kind: 'provenance-id-only',
      label: 'Provenance record',
      value: node.provenance_id,
      pass: node.pass_origin ?? node.phase,
      rationale: 'SOPHIA currently exposes the provenance identifier on graph nodes, but not the full record in the snapshot payload.',
      sourceRefs: [{ kind: 'provenance-id-only', value: node.provenance_id }]
    }
  ];
}

function buildNodeEvidence(node: GraphNode): GraphKitEvidenceItem[] {
  const items: GraphKitEvidenceItem[] = [];
  if (node.sourceTitle) {
    items.push({
      id: `${node.id}:source`,
      kind: 'source',
      label: 'Source context',
      summary: node.sourceTitle,
      sourceTitle: node.sourceTitle,
      confidence: node.evidence_strength,
      provenanceId: node.provenance_id
    });
  }

  for (const [index, ref] of (node.derived_from ?? []).entries()) {
    items.push({
      id: `${node.id}:derived:${index}`,
      kind: 'derived-claim',
      label: 'Derived from',
      summary: ref,
      relatedNodeId: ref
    });
  }

  return items;
}

function adaptNode(node: GraphNode): GraphKitNode {
  const classification = mapSophiaNodeKind(node);
  const confidence = node.evidence_strength ?? confidenceFromBand(node.confidenceBand);

  return {
    id: node.id,
    kind: classification.kind,
    title: node.label,
    preview: node.label,
    phase: node.phase,
    status: toEntityStatus(node.conflict_status),
    confidence,
    evidenceStrength: node.evidence_strength,
    sourceLabel: node.sourceTitle,
    isSeed: node.isSeed,
    isTraversed: node.isTraversed,
    tags: getNodeTraceTags(node),
    searchText: makeSearchText(node),
    metadata: {
      rawType: node.type,
      domain: node.domain,
      sourceTitle: node.sourceTitle,
      traversalDepth: node.traversalDepth,
      relevance: node.relevance,
      confidenceBand: node.confidenceBand ?? confidenceBandFromValue(confidence),
      passOrigin: node.pass_origin,
      derivedFromIds: node.derived_from ?? [],
      unresolvedTensionId: node.unresolved_tension_id,
      provenanceId: node.provenance_id,
      noveltyScore: node.novelty_score,
      taxonomyReason: classification.reason,
      taxonomyConfidence: classification.confidence,
      missingSignals: classification.missingSignals,
      extra: {
        depth_level: node.depth_level,
        label_length: node.label.length
      }
    },
    provenance: buildNodeProvenance(node),
    evidence: buildNodeEvidence(node)
  };
}

function buildEdgeProvenance(edge: GraphEdge): GraphKitProvenanceItem[] {
  if (!edge.provenance_id) return [];
  return [
    {
      id: edge.provenance_id,
      kind: 'provenance-id-only',
      label: 'Edge provenance record',
      value: edge.provenance_id,
      pass: edge.pass_origin ?? edge.phaseOrigin,
      rationale: edge.relation_rationale,
      sourceRefs: [{ kind: 'provenance-id-only', value: edge.provenance_id }]
    }
  ];
}

function buildEdgeEvidence(edge: GraphEdge): GraphKitEvidenceItem[] {
  const items: GraphKitEvidenceItem[] = [];

  if (edge.relation_rationale) {
    items.push({
      id: `${edgeId(edge)}:rationale`,
      kind: 'relation-rationale',
      label: 'Relation rationale',
      summary: edge.relation_rationale,
      confidence: edge.relation_confidence,
      provenanceId: edge.provenance_id
    });
  }

  for (const [index, source] of (edge.evidence_sources ?? []).entries()) {
    items.push({
      id: `${edgeId(edge)}:evidence:${index}`,
      kind: 'trace',
      label: 'Evidence source',
      summary: source,
      confidence: edge.relation_confidence,
      provenanceId: edge.provenance_id
    });
  }

  return items;
}

function adaptEdge(edge: GraphEdge): GraphKitEdge {
  return {
    id: edgeId(edge),
    from: edge.from,
    to: edge.to,
    kind: toEdgeKind(edge),
    phase: edge.phaseOrigin ?? edge.pass_origin,
    status: toEntityStatus(edge.conflict_status),
    confidence: edge.relation_confidence ?? edge.evidence_strength,
    rationale: edge.relation_rationale,
    evidenceCount: edge.evidence_count,
    metadata: {
      passOrigin: edge.pass_origin ?? edge.phaseOrigin,
      depthLevel: edge.depth_level,
      derivedFromIds: edge.derived_from ?? [],
      unresolvedTensionId: edge.unresolved_tension_id,
      provenanceId: edge.provenance_id,
      evidenceSources: edge.evidence_sources ?? [],
      extra: {
        weight: edge.weight,
        novelty_score: edge.novelty_score
      }
    },
    provenance: buildEdgeProvenance(edge),
    evidence: buildEdgeEvidence(edge)
  };
}

function adaptGhostNode(node: GraphGhostNode): GraphKitGhostNode {
  return {
    id: node.id,
    title: node.label,
    kind: 'candidate',
    reasonCode: node.reasonCode,
    phase: node.pass_origin,
    sourceTitle: node.sourceTitle,
    confidence: node.confidence,
    anchorNodeId: node.anchorNodeId
  };
}

function adaptGhostEdge(edge: GraphGhostEdge): GraphKitGhostEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.type,
    reasonCode: edge.reasonCode,
    phase: edge.pass_origin,
    confidence: edge.relation_confidence,
    rationale: edge.rationale_source
  };
}

function buildMissingDataNotes(
  nodes: GraphKitNode[],
  meta: GraphSnapshotMeta | null
): string[] {
  const notes = new Set<string>();

  if (!nodes.some((node) => node.kind === 'query')) {
    notes.add('Current SOPHIA graph snapshots do not include a query/question node.');
  }
  if (!nodes.some((node) => node.kind === 'evidence')) {
    notes.add('Evidence is available only as metadata and references today; SOPHIA does not yet emit first-class evidence nodes.');
  }
  if (!nodes.some((node) => node.kind === 'inference')) {
    notes.add('Inference steps are not emitted as explicit nodes, so inference is currently implied rather than inspectable.');
  }
  if (!nodes.some((node) => node.kind === 'conclusion')) {
    notes.add('Conclusion nodes are not distinct from synthesis/claim nodes in the current SOPHIA graph schema.');
  }
  if (!nodes.some((node) => node.provenance.length > 0)) {
    notes.add('Full provenance records are not embedded in current snapshots; only provenance IDs may be available.');
  }
  if (!meta?.query_run_id) {
    notes.add('Graph snapshots currently omit query-run context in most dogfood flows, limiting compare and playback fidelity.');
  }

  return [...notes];
}

function buildCompareResult(): GraphKitCompareResult | null {
  return null;
}

function nextTraceSequence(events: GraphKitTraceEvent[]): number {
  return events.length + 1;
}

function defaultPlaybackHint(overrides?: Partial<GraphKitTraceEvent['playback']>) {
  return {
    replayable: false,
    mode: 'event-focus' as const,
    missingCapabilities: [...PLAYBACK_MISSING_CAPABILITIES],
    ...overrides
  };
}

function nodeIdsByPhase(nodes: GraphKitNode[], phase: GraphKitPhase): string[] {
  return nodes.filter((node) => node.phase === phase).map((node) => node.id);
}

function nodeIdsByStatus(
  nodes: GraphKitNode[],
  status: GraphKitNode['status']
): string[] {
  return nodes.filter((node) => node.status === status).map((node) => node.id);
}

function edgeIdsByKind(
  edges: GraphKitEdge[],
  kinds: GraphKitEdgeKind[]
): string[] {
  const kindSet = new Set(kinds);
  return edges.filter((edge) => kindSet.has(edge.kind)).map((edge) => edge.id);
}

function firstNodeId(nodeIds: string[]): string | undefined {
  return nodeIds[0];
}

function pushTraceEvent(
  events: GraphKitTraceEvent[],
  event: Omit<GraphKitTraceEvent, 'sequence'>
): void {
  events.push({
    ...event,
    sequence: nextTraceSequence(events)
  });
}

function buildValidationSummary(
  reasoningQuality: SophiaTraceContext['reasoningQuality'],
  constitutionDeltas: SophiaTraceContext['constitutionDeltas']
): {
  status: GraphKitTraceEvent['status'];
  facts: GraphKitTraceEvent['facts'];
  focus?: GraphKitTraceEventFocus;
} | null {
  if (!reasoningQuality && (!constitutionDeltas || constitutionDeltas.length === 0)) return null;

  const flaggedClaimIds = new Set<string>();
  for (const dimension of reasoningQuality?.dimensions ?? []) {
    for (const claimId of dimension.flagged_claims ?? []) {
      flaggedClaimIds.add(claimId);
    }
  }

  const complianceSummary =
    constitutionDeltas?.map((delta) => `${delta.pass}:${delta.overall_compliance}`).join(', ') ?? 'n/a';
  const unresolvedViolations =
    constitutionDeltas?.reduce((count, delta) => count + delta.unresolved_violations.length, 0) ?? 0;

  return {
    status:
      unresolvedViolations > 0 || (reasoningQuality?.overall_score ?? 1) < 0.7
        ? 'warning'
        : 'complete',
    facts: [
      {
        label: 'overall score',
        value:
          typeof reasoningQuality?.overall_score === 'number'
            ? reasoningQuality.overall_score.toFixed(2)
            : 'n/a'
      },
      { label: 'flagged claims', value: `${flaggedClaimIds.size}` },
      { label: 'constitution', value: complianceSummary },
      { label: 'unresolved violations', value: `${unresolvedViolations}` }
    ],
    focus: flaggedClaimIds.size
      ? {
          primaryNodeId: firstNodeId([...flaggedClaimIds]),
          relatedNodeIds: [...flaggedClaimIds],
          inspectorSection: 'validation'
        }
      : {
          relatedNodeIds: [],
          inspectorSection: 'validation'
        }
  };
}

function buildTraceEvents(
  graph: GraphKitGraphViewModel,
  meta: GraphSnapshotMeta | null,
  enrichmentStatus: EnrichmentStatusEvent | null,
  traceContext: SophiaTraceContext
): GraphKitTraceEvent[] {
  const events: GraphKitTraceEvent[] = [];
  const trace = meta?.retrievalTrace;
  const retrievalTimestamp = meta?.retrievalTimestamp;
  const retrievalNodeIds = nodeIdsByPhase(graph.nodes, 'retrieval');
  const analysisNodeIds = nodeIdsByPhase(graph.nodes, 'analysis');
  const critiqueNodeIds = nodeIdsByPhase(graph.nodes, 'critique');
  const synthesisNodeIds = nodeIdsByPhase(graph.nodes, 'synthesis');
  const contradictionNodeIds = [
    ...nodeIdsByStatus(graph.nodes, 'contradicted'),
    ...nodeIdsByStatus(graph.nodes, 'unresolved')
  ];
  const contradictionEdgeIds = edgeIdsByKind(graph.edges, ['contradicts', 'unresolved']);

  pushTraceEvent(events, {
    id: 'snapshot-overview',
    kind: 'snapshot-captured',
    title: 'Graph snapshot',
    summary: 'Current workspace snapshot derived from SOPHIA retrieval and reasoning outputs.',
    status: meta?.retrievalDegraded ? 'warning' : 'complete',
    source: 'snapshot-meta',
    timestamp: retrievalTimestamp,
    facts: [
      { label: 'seed nodes', value: `${meta?.seedNodeIds?.length ?? 0}` },
      { label: 'traversed nodes', value: `${meta?.traversedNodeIds?.length ?? 0}` },
      { label: 'max hops', value: `${meta?.maxHops ?? 0}` },
      { label: 'context', value: meta?.contextSufficiency ?? 'unknown' }
    ],
    focus: {
      primaryNodeId: firstNodeId(meta?.traversedNodeIds ?? retrievalNodeIds),
      relatedNodeIds: meta?.traversedNodeIds ?? retrievalNodeIds
    },
    playback: defaultPlaybackHint({
      mode: 'snapshot-only',
      missingCapabilities: [...PLAYBACK_MISSING_CAPABILITIES]
    })
  });

  if (traceContext.queryText || meta?.query_run_id || trace?.queryDecomposition) {
    pushTraceEvent(events, {
      id: 'query-received',
      kind: 'query-received',
      title: 'Query received',
      summary:
        traceContext.queryText?.trim() ||
        'Run metadata captured the query context, but the current snapshot does not retain the full user prompt.',
      phase: 'retrieval',
      status: 'complete',
      source: traceContext.queryText ? 'sophia-stream' : 'snapshot-meta',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'query run', value: meta?.query_run_id ?? 'missing' },
        {
          label: 'focus mode',
          value: trace?.queryDecomposition?.focusMode ?? 'n/a'
        },
        {
          label: 'domain filter',
          value: trace?.queryDecomposition?.domainFilter ?? 'none'
        },
        {
          label: 'lexical terms',
          value: trace?.queryDecomposition?.lexicalTerms.join(', ') || 'none'
        }
      ],
      focus: {
        primaryNodeId: firstNodeId(meta?.seedNodeIds ?? retrievalNodeIds),
        relatedNodeIds: meta?.seedNodeIds ?? retrievalNodeIds
      },
      playback: defaultPlaybackHint()
    });
  }

  if (trace) {
    pushTraceEvent(events, {
      id: 'evidence-added',
      kind: 'evidence-added',
      title: 'Evidence added to retrieval context',
      summary: 'Seed claims and traversal candidates were added as the first evidence layer for the run.',
      phase: 'retrieval',
      status: 'complete',
      source: 'snapshot-meta',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'seed pool', value: `${trace.seedPoolCount}` },
        { label: 'selected seeds', value: `${trace.selectedSeedCount}` },
        { label: 'seed claims', value: `${trace.seedClaims?.length ?? 0}` },
        { label: 'dense seeds', value: `${trace.denseSeedCount ?? 0}` }
      ],
      focus: {
        primaryNodeId: firstNodeId(meta?.seedNodeIds ?? retrievalNodeIds),
        relatedNodeIds: meta?.seedNodeIds ?? retrievalNodeIds,
        inspectorSection: 'evidence'
      },
      playback: defaultPlaybackHint()
    });
  }

  if (analysisNodeIds.length > 0 || critiqueNodeIds.length > 0) {
    pushTraceEvent(events, {
      id: 'claims-created',
      kind: 'claim-created',
      title: 'Claims created',
      summary: 'The graph now contains explicit claim nodes from SOPHIA analysis and critique passes.',
      phase: analysisNodeIds.length > 0 ? 'analysis' : 'critique',
      status: 'complete',
      source: 'graph-derived',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'analysis claims', value: `${analysisNodeIds.length}` },
        { label: 'critique claims', value: `${critiqueNodeIds.length}` },
        { label: 'total claims', value: `${graph.nodes.filter((node) => node.kind === 'claim').length}` }
      ],
      focus: {
        primaryNodeId: firstNodeId(analysisNodeIds) ?? firstNodeId(critiqueNodeIds),
        relatedNodeIds: [...analysisNodeIds, ...critiqueNodeIds]
      },
      playback: defaultPlaybackHint()
    });
  }

  if (trace?.queryDecomposition) {
    pushTraceEvent(events, {
      id: 'query-decomposition',
      kind: 'note',
      title: 'Query decomposition',
      summary: 'How retrieval framed the question before graph expansion.',
      phase: 'retrieval',
      status: 'complete',
      source: 'snapshot-meta',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'focus mode', value: trace.queryDecomposition.focusMode },
        { label: 'domain filter', value: trace.queryDecomposition.domainFilter ?? 'none' },
        { label: 'hybrid mode', value: trace.queryDecomposition.hybridMode },
        { label: 'lexical terms', value: trace.queryDecomposition.lexicalTerms.join(', ') || 'none' }
      ],
      focus: {
        primaryNodeId: firstNodeId(meta?.seedNodeIds ?? retrievalNodeIds),
        relatedNodeIds: meta?.seedNodeIds ?? retrievalNodeIds
      },
      playback: defaultPlaybackHint()
    });
  }

  if (trace) {
    pushTraceEvent(events, {
      id: 'traversal',
      kind: 'note',
      title: 'Traversal and relation expansion',
      summary: 'Reasoning graph expansion from the chosen seed set.',
      phase: 'retrieval',
      status: 'complete',
      source: 'snapshot-meta',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'mode', value: trace.traversalMode ?? 'n/a' },
        { label: 'max hops', value: `${trace.traversalMaxHops ?? 'n/a'}` },
        { label: 'traversed claims', value: `${trace.traversedClaimCount}` },
        { label: 'relations kept', value: `${trace.relationKeptCount}/${trace.relationCandidateCount}` }
      ],
      focus: {
        primaryNodeId: firstNodeId(meta?.traversedNodeIds ?? retrievalNodeIds),
        relatedNodeIds: meta?.traversedNodeIds ?? retrievalNodeIds
      },
      playback: defaultPlaybackHint()
    });

    pushTraceEvent(events, {
      id: 'pruning',
      kind: 'note',
      title: 'Pruning and confidence gates',
      summary: 'Candidates withheld by confidence or integrity checks.',
      phase: 'retrieval',
      status:
        (trace.rejectedClaimCount ?? 0) > 0 || (trace.rejectedRelationCount ?? 0) > 0
          ? 'warning'
          : 'complete',
      source: 'snapshot-meta',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'rejected claims', value: `${trace.rejectedClaimCount ?? 0}` },
        { label: 'rejected relations', value: `${trace.rejectedRelationCount ?? 0}` },
        { label: 'trusted edges only', value: trace.traversalTrustedEdgesOnly ? 'yes' : 'no' },
        { label: 'domain aware', value: trace.traversalDomainAware ? 'yes' : 'no' }
      ],
      focus: {
        relatedNodeIds: graph.ghostNodes
          .map((node) => node.anchorNodeId)
          .filter((value): value is string => Boolean(value))
      },
      playback: defaultPlaybackHint()
    });

    if (trace.closureStats) {
      pushTraceEvent(events, {
        id: 'inference-produced',
        kind: 'inference-produced',
        title: 'Inference produced',
        summary: 'Closure and synthesis preparation signals were generated from retrieved claims and relations.',
        phase: 'synthesis',
        status: 'complete',
        source: 'snapshot-meta',
        timestamp: retrievalTimestamp,
        facts: [
          { label: 'major theses', value: `${trace.closureStats.majorThesisCount}` },
          {
            label: 'units completed',
            value: `${trace.closureStats.unitsCompleted}/${trace.closureStats.unitsAttempted}`
          },
          { label: 'claims added', value: `${trace.closureStats.claimsAddedForClosure}` },
          { label: 'cap-limited', value: `${trace.closureStats.capLimitedUnits}` }
        ],
        focus: {
          primaryNodeId: firstNodeId(synthesisNodeIds),
          relatedNodeIds: synthesisNodeIds
        },
        playback: defaultPlaybackHint()
      });
    }
  }

  if (contradictionNodeIds.length > 0 || contradictionEdgeIds.length > 0) {
    pushTraceEvent(events, {
      id: 'contradiction-detected',
      kind: 'contradiction-detected',
      title: 'Contradiction detected',
      summary: 'The current graph contains contested or unresolved reasoning that should be inspected before trusting the synthesis.',
      phase: 'critique',
      status: 'warning',
      source: 'graph-derived',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'contradicted nodes', value: `${nodeIdsByStatus(graph.nodes, 'contradicted').length}` },
        { label: 'unresolved nodes', value: `${nodeIdsByStatus(graph.nodes, 'unresolved').length}` },
        { label: 'contradiction edges', value: `${contradictionEdgeIds.length}` }
      ],
      focus: {
        primaryNodeId: firstNodeId(contradictionNodeIds),
        relatedNodeIds: contradictionNodeIds,
        edgeIds: contradictionEdgeIds,
        inspectorSection: 'validation'
      },
      playback: defaultPlaybackHint()
    });
  }

  const validationSummary = buildValidationSummary(
    traceContext.reasoningQuality,
    traceContext.constitutionDeltas
  );
  if (validationSummary) {
    pushTraceEvent(events, {
      id: 'validation-run',
      kind: 'validation-run',
      title: 'Validation run',
      summary: 'Reasoning-quality and constitution checks completed for this run.',
      phase: 'synthesis',
      status: validationSummary.status,
      source: 'sophia-stream',
      timestamp: retrievalTimestamp,
      facts: validationSummary.facts,
      focus: validationSummary.focus,
      playback: defaultPlaybackHint()
    });
  } else {
    pushTraceEvent(events, {
      id: 'validation-placeholder',
      kind: 'validation-run',
      title: 'Validation run not captured',
      summary: 'SOPHIA can emit reasoning-quality and constitution results, but this workspace snapshot does not currently receive them for every run.',
      phase: 'synthesis',
      status: 'todo',
      source: 'placeholder',
      facts: [
        { label: 'available elsewhere', value: 'conversation cache and verification flows' },
        { label: 'missing here', value: 'normalized validation event payload' }
      ],
      focus: {
        relatedNodeIds: [],
        inspectorSection: 'validation'
      },
      playback: defaultPlaybackHint()
    });
  }

  if (synthesisNodeIds.length > 0) {
    pushTraceEvent(events, {
      id: 'synthesis-completed',
      kind: 'synthesis-completed',
      title: 'Synthesis completed',
      summary: 'Synthesis-phase graph nodes are present, indicating the run reached a merged reasoning state.',
      phase: 'synthesis',
      status: 'complete',
      source: 'graph-derived',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'synthesis nodes', value: `${synthesisNodeIds.length}` },
        {
          label: 'synthesis claims',
          value: `${graph.nodes.filter((node) => node.kind === 'synthesis').length}`
        }
      ],
      focus: {
        primaryNodeId: firstNodeId(synthesisNodeIds),
        relatedNodeIds: synthesisNodeIds
      },
      playback: defaultPlaybackHint()
    });
  }

  if (traceContext.finalOutputText?.trim()) {
    pushTraceEvent(events, {
      id: 'final-output-created',
      kind: 'final-output-created',
      title: 'Final output created',
      summary: 'The assistant produced a final response for the current query run.',
      phase: 'synthesis',
      status: 'complete',
      source: 'sophia-stream',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'characters', value: `${traceContext.finalOutputText.trim().length}` },
        { label: 'query run', value: meta?.query_run_id ?? 'missing' }
      ],
      focus: {
        primaryNodeId: firstNodeId(synthesisNodeIds),
        relatedNodeIds: synthesisNodeIds,
        inspectorSection: 'summary'
      },
      playback: defaultPlaybackHint()
    });
  }

  if (enrichmentStatus) {
    pushTraceEvent(events, {
      id: 'enrichment',
      kind: 'enrichment-updated',
      title: 'Enrichment pipeline',
      summary: 'Canonical promotion state for staged graph enrichment.',
      status:
        enrichmentStatus.status === 'failed'
          ? 'warning'
          : enrichmentStatus.status === 'staged'
            ? 'active'
            : 'complete',
      source: 'sophia-stream',
      facts: [
        { label: 'status', value: enrichmentStatus.status },
        { label: 'staged', value: `${enrichmentStatus.stagedCount ?? 0}` },
        { label: 'promoted', value: `${enrichmentStatus.promotedCount ?? 0}` },
        { label: 'reason', value: enrichmentStatus.reason ?? 'n/a' }
      ],
      focus: {
        primaryNodeId: firstNodeId(synthesisNodeIds),
        relatedNodeIds: synthesisNodeIds
      },
      playback: defaultPlaybackHint()
    });
  }

  pushTraceEvent(events, {
    id: 'playback-placeholder',
    kind: 'note',
    title: 'Playback roadmap',
    summary: 'Event selection is real today; frame-by-frame replay and scrubbing still require persisted run history and graph-frame diffs.',
    status: 'todo',
    source: 'placeholder',
    facts: [
      { label: 'TODO', value: 'Playback scrubber and state replay' },
      { label: 'TODO', value: 'Compare mode timeline diff' },
      { label: 'TODO', value: 'Frame-level graph snapshots per pass' }
    ],
    focus: {
      relatedNodeIds: []
    },
    playback: defaultPlaybackHint()
  });

  return events;
}

function buildPlaybackDescriptor(): GraphKitTracePlaybackDescriptor {
  return {
    mode: 'event-focus',
    canReplay: false,
    hasEventSelection: true,
    missingCapabilities: [...PLAYBACK_MISSING_CAPABILITIES],
    todo: [
      'TODO playback controls',
      'TODO scrubber linked to graph frames',
      'TODO persisted run-event import/export'
    ]
  };
}

function buildSummary(
  graph: GraphKitGraphViewModel,
  meta: GraphSnapshotMeta | null
) {
  const warnings = [...graph.missingData];
  if (meta?.retrievalDegraded) {
    warnings.unshift(`Retrieval degraded: ${meta.retrievalDegradedReason ?? 'unknown reason'}`);
  }
  if (graph.nodes.length === 0) {
    warnings.unshift('No graph nodes are currently available for this session.');
  }

  return {
    title: 'Restormel Graph Workspace',
    subtitle: 'Dogfood workspace for inspecting reasoning structure inside SOPHIA.',
    metrics: [
      { label: 'nodes', value: `${graph.nodes.length}` },
      { label: 'edges', value: `${graph.edges.length}` },
      { label: 'seed nodes', value: `${meta?.seedNodeIds?.length ?? 0}` },
      { label: 'context', value: meta?.contextSufficiency ?? 'unknown' }
    ],
    warnings
  };
}

function buildGraphViewModel(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  ghostNodes: GraphGhostNode[];
  ghostEdges: GraphGhostEdge[];
  meta: GraphSnapshotMeta | null;
}): GraphKitGraphViewModel {
  const nodes = params.nodes.map(adaptNode);
  const edges = params.edges.map(adaptEdge);

  return {
    nodes,
    edges,
    ghostNodes: params.ghostNodes.map(adaptGhostNode),
    ghostEdges: params.ghostEdges.map(adaptGhostEdge),
    compareResult: buildCompareResult(),
    missingData: buildMissingDataNotes(nodes, params.meta)
  };
}

export function adaptSophiaGraphWorkspace(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: GraphSnapshotMeta | null;
  enrichmentStatus?: EnrichmentStatusEvent | null;
  traceContext?: SophiaTraceContext;
}): GraphKitWorkspaceData {
  const meta = params.meta ?? null;
  const enrichmentStatus = params.enrichmentStatus ?? null;
  const traceContext = params.traceContext ?? {};

  // SOPHIA-specific assumption boundary:
  // - source/claim is the only concrete node schema today
  // - richer Graph Kit taxonomy is inferred from phase and conflict metadata
  const graph = buildGraphViewModel({
    nodes: params.nodes,
    edges: params.edges,
    ghostNodes: meta?.rejectedNodes ?? [],
    ghostEdges: meta?.rejectedEdges ?? [],
    meta
  });

  return {
    summary: buildSummary(graph, meta),
    graph,
    traceEvents: buildTraceEvents(graph, meta, enrichmentStatus, traceContext),
    playback: buildPlaybackDescriptor()
  };
}

export function buildSophiaWorkspaceFromReferences(params: {
  claims: Claim[];
  relations: RelationBundle[];
}): GraphKitWorkspaceData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const claimPhase = new Map<string, AnalysisPhase>();

  for (const claim of params.claims) {
    claimPhase.set(claim.id, claim.phase);
    if (nodeIds.has(claim.id)) continue;
    nodes.push({
      id: claim.id,
      type: 'claim',
      label: claim.text,
      phase: claim.phase,
      pass_origin: claim.phase,
      depth_level: PHASE_DEPTH_LEVEL[claim.phase],
      evidence_strength: claim.confidence,
      derived_from: claim.backRefIds,
      conflict_status: claim.phase === 'critique' ? 'contested' : 'none'
    });
    nodeIds.add(claim.id);
  }

  for (const bundle of params.relations) {
    const phase = claimPhase.get(bundle.claimId) ?? 'analysis';
    for (const relation of bundle.relations) {
      const id = `${bundle.claimId}:${relation.type}:${relation.target}`;
      if (edgeIds.has(id)) continue;
      edges.push({
        from: bundle.claimId,
        to: relation.target,
        type: relation.type,
        phaseOrigin: phase,
        pass_origin: phase,
        depth_level: PHASE_DEPTH_LEVEL[phase],
        conflict_status:
          relation.type === 'contradicts'
            ? 'contested'
            : relation.type === 'resolves'
              ? 'resolved'
              : 'none'
      });
      edgeIds.add(id);
    }
  }

  return adaptSophiaGraphWorkspace({
    nodes,
    edges,
    meta: {
      contextSufficiency:
        nodes.length >= 8 ? 'strong' : nodes.length >= 3 ? 'moderate' : 'sparse',
      retrievalTimestamp: new Date().toISOString()
    }
  });
}
