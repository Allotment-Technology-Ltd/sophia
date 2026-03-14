import type {
  EnrichmentStatusEvent,
  GraphEdge,
  GraphGhostEdge,
  GraphGhostNode,
  GraphNode,
  GraphSnapshotMeta
} from '@restormel/contracts/api';
import type { ReasoningEvent, RunTrace } from '@restormel/contracts/trace';
import type { NormalizedRunTrace } from '@restormel/contracts/trace-ingestion';
import type { ReasoningEvaluation } from '@restormel/contracts/verification';
import {
  type ReasoningClassificationConfidence,
  type ReasoningObjectEdge,
  type ReasoningObjectEvidenceItem,
  type ReasoningObjectKind,
  type ReasoningObjectNode,
  type ReasoningObjectPhase,
  type ReasoningObjectProvenanceItem,
  type ReasoningObjectSnapshot,
  type ReasoningObjectStatus,
  type ReasoningObjectTraceEvent,
  type ReasoningObjectTraceEventFocus,
  type ReasoningObjectValidationDelta
} from '@restormel/contracts/reasoning-object';
import { getNodeTraceTags } from '@restormel/graph-core/trace';
import {
  normalizeRunTrace,
  normalizeSophiaReasoningEvents,
  normalizedTraceToReasoningObjectEvents
} from '@restormel/observability';
import { evaluateReasoningGraph as evaluateReasoningGraphStructure } from '@restormel/graph-core/evaluation';

const PLAYBACK_MISSING_CAPABILITIES = [
  'Per-event graph frames are not persisted; only the latest graph snapshot is available in the workspace.',
  'Pass-level timestamps are incomplete, so scrubbing cannot yet replay the real order and duration of reasoning steps.',
  'Historical run-event streams are cached elsewhere in SOPHIA but are not yet normalized into a package-ready trace contract.'
] as const;

export interface SophiaReasoningObjectContext {
  queryText?: string | null;
  finalOutputText?: string | null;
  reasoningQuality?: ReasoningEvaluation | null;
  reasoningEvents?: ReasoningEvent[] | null;
  runTrace?: RunTrace | null;
  normalizedTrace?: NormalizedRunTrace | null;
  constitutionDeltas?: Array<{
    pass: 'analysis' | 'critique' | 'synthesis';
    introduced_violations: string[];
    resolved_violations: string[];
    unresolved_violations: string[];
    overall_compliance: 'pass' | 'partial' | 'fail';
  }> | null;
}

export interface SophiaReasoningObjectBundle {
  snapshot: ReasoningObjectSnapshot;
  meta: GraphSnapshotMeta | null;
  ghostNodes: GraphGhostNode[];
  ghostEdges: GraphGhostEdge[];
  enrichmentStatus: EnrichmentStatusEvent | null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value: string, max = 120): string {
  return value.trim().length > max ? value.trim().slice(0, max) : value.trim();
}

function nodeCompareKey(kind: ReasoningObjectKind, title: string): string {
  return `${kind}|${normalize(clip(title))}`;
}

function edgeId(edge: Pick<GraphEdge, 'from' | 'to' | 'type'>): string {
  return `${edge.from}:${edge.type}:${edge.to}`;
}

function edgeCompareKey(
  kind: ReasoningObjectEdge['kind'],
  fromTitle: string,
  toTitle: string
): string {
  return `${kind}|${normalize(clip(fromTitle))}|${normalize(clip(toTitle))}`;
}

function toStatus(
  conflictStatus?: GraphNode['conflict_status'] | GraphEdge['conflict_status']
): ReasoningObjectStatus {
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

function classifySophiaNode(node: GraphNode): {
  kind: ReasoningObjectKind;
  confidence: ReasoningClassificationConfidence;
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

function buildNodeProvenance(node: GraphNode): ReasoningObjectProvenanceItem[] {
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

function buildNodeEvidence(node: GraphNode): ReasoningObjectEvidenceItem[] {
  const items: ReasoningObjectEvidenceItem[] = [];
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
      relatedObjectId: ref
    });
  }

  return items;
}

function adaptNode(node: GraphNode): ReasoningObjectNode {
  const classification = classifySophiaNode(node);
  const confidence = node.evidence_strength ?? confidenceFromBand(node.confidenceBand);

  return {
    id: node.id,
    kind: classification.kind,
    title: node.label,
    preview: node.label,
    phase: node.phase,
    status: toStatus(node.conflict_status),
    confidence,
    evidenceStrength: node.evidence_strength,
    sourceLabel: node.sourceTitle,
    isSeed: node.isSeed,
    isTraversed: node.isTraversed,
    tags: getNodeTraceTags(node),
    searchText: makeSearchText(node),
    classification,
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
      compareKey: nodeCompareKey(classification.kind, node.label),
      extra: {
        depth_level: node.depth_level,
        label_length: node.label.length
      }
    },
    provenance: buildNodeProvenance(node),
    evidence: buildNodeEvidence(node)
  };
}

function buildEdgeProvenance(edge: GraphEdge): ReasoningObjectProvenanceItem[] {
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

function buildEdgeEvidence(edge: GraphEdge): ReasoningObjectEvidenceItem[] {
  const items: ReasoningObjectEvidenceItem[] = [];

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

function adaptEdges(
  edges: GraphEdge[],
  nodesById: Map<string, ReasoningObjectNode>
): ReasoningObjectEdge[] {
  return edges.map((edge) => {
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    const fromTitle = fromNode?.title ?? edge.from;
    const toTitle = toNode?.title ?? edge.to;

    return {
      id: edgeId(edge),
      from: edge.from,
      to: edge.to,
      kind: edge.type,
      phase: edge.phaseOrigin ?? edge.pass_origin,
      status: toStatus(edge.conflict_status),
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
        compareKey: edgeCompareKey(edge.type, fromTitle, toTitle),
        extra: {
          weight: edge.weight,
          novelty_score: edge.novelty_score
        }
      },
      provenance: buildEdgeProvenance(edge),
      evidence: buildEdgeEvidence(edge)
    };
  });
}

function buildMissingDataNotes(
  nodes: ReasoningObjectNode[],
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

function nextTraceSequence(events: ReasoningObjectTraceEvent[]): number {
  return events.length + 1;
}

function firstNodeId(nodeIds: string[]): string | undefined {
  return nodeIds[0];
}

function nodeIdsByPhase(nodes: ReasoningObjectNode[], phase: ReasoningObjectPhase): string[] {
  return nodes.filter((node) => node.phase === phase).map((node) => node.id);
}

function nodeIdsByStatus(
  nodes: ReasoningObjectNode[],
  status: ReasoningObjectNode['status']
): string[] {
  return nodes.filter((node) => node.status === status).map((node) => node.id);
}

function edgeIdsByKind(
  edges: ReasoningObjectEdge[],
  kinds: ReasoningObjectEdge['kind'][]
): string[] {
  const kindSet = new Set(kinds);
  return edges.filter((edge) => kindSet.has(edge.kind)).map((edge) => edge.id);
}

function pushTraceEvent(
  events: ReasoningObjectTraceEvent[],
  event: Omit<ReasoningObjectTraceEvent, 'sequence'>
): void {
  events.push({
    ...event,
    sequence: nextTraceSequence(events)
  });
}

function buildValidationEvaluation(
  reasoningQuality: SophiaReasoningObjectContext['reasoningQuality'],
  constitutionDeltas: SophiaReasoningObjectContext['constitutionDeltas']
): {
  evaluation?: ReasoningObjectSnapshot['evaluation'];
  traceFocus?: ReasoningObjectTraceEventFocus;
  traceStatus?: ReasoningObjectTraceEvent['status'];
  traceFacts?: ReasoningObjectTraceEvent['facts'];
} {
  if (!reasoningQuality && (!constitutionDeltas || constitutionDeltas.length === 0)) {
    return {};
  }

  const flaggedNodeIds = new Set<string>();
  for (const dimension of reasoningQuality?.dimensions ?? []) {
    for (const claimId of dimension.flagged_claims ?? []) {
      flaggedNodeIds.add(claimId);
    }
  }

  const normalizedDeltas: ReasoningObjectValidationDelta[] =
    constitutionDeltas?.map((delta) => ({
      phase: delta.pass,
      introducedViolations: delta.introduced_violations,
      resolvedViolations: delta.resolved_violations,
      unresolvedViolations: delta.unresolved_violations,
      overallCompliance: delta.overall_compliance
    })) ?? [];

  const unresolvedViolations = normalizedDeltas.reduce(
    (count, delta) => count + delta.unresolvedViolations.length,
    0
  );
  const complianceSummary =
    normalizedDeltas.map((delta) => `${delta.phase}:${delta.overallCompliance}`).join(', ') || 'n/a';

  return {
    evaluation: {
      overallScore: reasoningQuality?.overall_score,
      flaggedNodeIds: [...flaggedNodeIds],
      reasoningQuality: reasoningQuality ?? undefined,
      validationDeltas: normalizedDeltas,
      notes: unresolvedViolations > 0
        ? ['Unresolved constitutional violations remain in the current run context.']
        : [],
      graphFindings: []
    },
    traceFocus: flaggedNodeIds.size
      ? {
          primaryNodeId: firstNodeId([...flaggedNodeIds]),
          relatedNodeIds: [...flaggedNodeIds],
          inspectorSection: 'validation'
        }
      : {
          relatedNodeIds: [],
          inspectorSection: 'validation'
        },
    traceStatus:
      unresolvedViolations > 0 || (reasoningQuality?.overall_score ?? 1) < 0.7
        ? 'warning'
        : 'complete',
    traceFacts: [
      {
        label: 'overall score',
        value:
          typeof reasoningQuality?.overall_score === 'number'
            ? reasoningQuality.overall_score.toFixed(2)
            : 'n/a'
      },
      { label: 'flagged claims', value: `${flaggedNodeIds.size}` },
      { label: 'constitution', value: complianceSummary },
      { label: 'unresolved violations', value: `${unresolvedViolations}` }
    ]
  };
}

function resolveNormalizedTrace(
  traceContext: SophiaReasoningObjectContext
): NormalizedRunTrace | null {
  if (traceContext.normalizedTrace) return traceContext.normalizedTrace;
  if (traceContext.runTrace) return normalizeRunTrace(traceContext.runTrace);
  if (traceContext.reasoningEvents && traceContext.reasoningEvents.length > 0) {
    return normalizeSophiaReasoningEvents(traceContext.reasoningEvents, {
      query: traceContext.queryText ?? undefined
    });
  }
  return null;
}

function buildTraceEvents(
  graph: ReasoningObjectSnapshot['graph'],
  meta: GraphSnapshotMeta | null,
  enrichmentStatus: EnrichmentStatusEvent | null,
  traceContext: SophiaReasoningObjectContext
): ReasoningObjectTraceEvent[] {
  const normalizedTrace = resolveNormalizedTrace(traceContext);
  if (normalizedTrace && normalizedTrace.events.length > 0) {
    return normalizedTraceToReasoningObjectEvents(normalizedTrace);
  }

  const events: ReasoningObjectTraceEvent[] = [];
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
    }
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
      source: traceContext.queryText ? 'run-stream' : 'snapshot-meta',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'query run', value: meta?.query_run_id ?? 'missing' },
        { label: 'focus mode', value: trace?.queryDecomposition?.focusMode ?? 'n/a' },
        { label: 'domain filter', value: trace?.queryDecomposition?.domainFilter ?? 'none' },
        { label: 'lexical terms', value: trace?.queryDecomposition?.lexicalTerms.join(', ') || 'none' }
      ],
      focus: {
        primaryNodeId: firstNodeId(meta?.seedNodeIds ?? retrievalNodeIds),
        relatedNodeIds: meta?.seedNodeIds ?? retrievalNodeIds
      }
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
      }
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
      }
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
      }
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
      }
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
        relatedNodeIds: []
      }
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
        }
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
      }
    });
  }

  const validation = buildValidationEvaluation(
    traceContext.reasoningQuality,
    traceContext.constitutionDeltas
  );
  if (validation.evaluation && validation.traceFacts && validation.traceStatus) {
    pushTraceEvent(events, {
      id: 'validation-run',
      kind: 'validation-run',
      title: 'Validation run',
      summary: 'Reasoning-quality and constitution checks completed for this run.',
      phase: 'synthesis',
      status: validation.traceStatus,
      source: 'run-stream',
      timestamp: retrievalTimestamp,
      facts: validation.traceFacts,
      focus: validation.traceFocus
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
      }
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
      }
    });
  }

  if (traceContext.finalOutputText?.trim()) {
    pushTraceEvent(events, {
      id: 'final-output-created',
      kind: 'final-output-created',
      title: 'Final output created',
      summary: 'A final narrative answer was captured for the run.',
      phase: 'synthesis',
      status: 'complete',
      source: 'run-stream',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'output length', value: `${traceContext.finalOutputText.trim().length} chars` },
        { label: 'snapshot id', value: meta?.snapshot_id ?? 'missing' }
      ],
      focus: {
        primaryNodeId: firstNodeId(synthesisNodeIds),
        relatedNodeIds: synthesisNodeIds
      }
    });
  }

  if (enrichmentStatus) {
    pushTraceEvent(events, {
      id: 'enrichment-status',
      kind: 'enrichment-updated',
      title: 'Enrichment status',
      summary: 'Post-run graph enrichment status is available for this snapshot.',
      phase: 'synthesis',
      status: enrichmentStatus.status === 'failed' ? 'warning' : 'complete',
      source: 'run-stream',
      timestamp: retrievalTimestamp,
      facts: [
        { label: 'status', value: enrichmentStatus.status },
        { label: 'staged', value: `${enrichmentStatus.stagedCount ?? 0}` },
        { label: 'promoted', value: `${enrichmentStatus.promotedCount ?? 0}` }
      ],
      focus: {
        relatedNodeIds: []
      }
    });
  }

  return events;
}

function buildOutputs(
  nodes: ReasoningObjectNode[],
  traceContext: SophiaReasoningObjectContext
): ReasoningObjectSnapshot['outputs'] {
  const outputs: ReasoningObjectSnapshot['outputs'] = [];
  const synthesisNodeIds = nodes
    .filter((node) => node.kind === 'synthesis' || node.kind === 'conclusion')
    .map((node) => node.id);

  if (traceContext.finalOutputText?.trim()) {
    outputs.push({
      id: 'final-output',
      kind: 'final-output',
      title: 'Final output',
      text: traceContext.finalOutputText.trim(),
      phase: 'synthesis',
      derivedNodeIds: synthesisNodeIds
    });
  }

  return outputs;
}

export function adaptSophiaReasoningObjectBundle(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: GraphSnapshotMeta | null;
  enrichmentStatus?: EnrichmentStatusEvent | null;
  traceContext?: SophiaReasoningObjectContext;
  source?: ReasoningObjectSnapshot['version']['source'];
}): SophiaReasoningObjectBundle {
  const meta = params.meta ?? null;
  const enrichmentStatus = params.enrichmentStatus ?? null;
  const traceContext = params.traceContext ?? {};
  const nodes = params.nodes.map(adaptNode);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = adaptEdges(params.edges, nodesById);
  const graph = {
    nodes,
    edges,
    missingData: buildMissingDataNotes(nodes, meta)
  };
  const trace = buildTraceEvents(graph, meta, enrichmentStatus, traceContext);
  const validation = buildValidationEvaluation(
    traceContext.reasoningQuality,
    traceContext.constitutionDeltas
  );
  const outputs = buildOutputs(nodes, traceContext);
  const graphEvaluation = evaluateReasoningGraphStructure({
    graph,
    outputs
  });

  return {
    meta,
    ghostNodes: meta?.rejectedNodes ?? [],
    ghostEdges: meta?.rejectedEdges ?? [],
    enrichmentStatus,
    snapshot: {
      version: {
        schemaVersion: 1,
        source: params.source ?? 'sophia-graph-snapshot',
        queryRunId: meta?.query_run_id,
        snapshotId: meta?.snapshot_id,
        parentSnapshotId: meta?.parent_snapshot_id,
        passSequence: meta?.pass_sequence,
        generatedAt: meta?.retrievalTimestamp
      },
      graph,
      trace,
      outputs,
      evaluation: {
        ...(validation.evaluation ?? {
          flaggedNodeIds: [],
          validationDeltas: [],
          notes: []
        }),
        graphSummary: graphEvaluation.summary,
        graphFindings: graphEvaluation.findings,
        notes: [
          ...((validation.evaluation?.notes ?? [])),
          ...(graphEvaluation.summary.totalFindings > 0 ? [graphEvaluation.summary.topLine] : [])
        ]
      }
    }
  };
}

export function getSophiaPlaybackMissingCapabilities(): string[] {
  return [...PLAYBACK_MISSING_CAPABILITIES];
}
