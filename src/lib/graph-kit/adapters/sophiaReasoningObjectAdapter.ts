import type {
  EnrichmentStatusEvent,
  GraphEdge,
  GraphGhostEdge,
  GraphGhostNode,
  GraphNode,
  GraphSnapshotMeta,
  GroundingSource
} from '@restormel/contracts/api';
import type { SourceReference } from '@restormel/contracts/references';
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
import { evaluateReasoningGraph as evaluateReasoningGraphStructure } from '@restormel/graph-reasoning-extensions/evaluation';

const PLAYBACK_MISSING_CAPABILITIES = [
  'Per-event graph frames are not persisted; only the latest graph snapshot is available in the workspace.',
  'Pass-level timestamps are incomplete, so scrubbing cannot yet replay the real order and duration of reasoning steps.',
  'Historical run-event streams are cached elsewhere in SOPHIA but are not yet normalized into a package-ready trace contract.'
] as const;

export interface SophiaReasoningObjectContext {
  queryText?: string | null;
  finalOutputText?: string | null;
  reasoningQuality?: ReasoningEvaluation | null;
  sources?: SourceReference[] | null;
  groundingSources?: GroundingSource[] | null;
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

function artifactToken(...parts: Array<string | number | null | undefined>): string {
  const token = parts
    .map((part) => normalize(String(part ?? '')))
    .filter(Boolean)
    .join('-')
    .slice(0, 96);
  return token || 'item';
}

function artifactId(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  return `${prefix}:${artifactToken(...parts)}`;
}

function toReasoningPhase(
  phase?: 'analysis' | 'critique' | 'synthesis' | 'retrieval' | 'verification' | null
): ReasoningObjectPhase | undefined {
  if (!phase) return undefined;
  if (phase === 'verification') return 'synthesis';
  return phase;
}

function describeExternalResource(title: string | undefined, url: string): string {
  if (title?.trim()) return title.trim();
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return clip(url, 72);
  }
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

function makeSyntheticNode(params: {
  id: string;
  kind: ReasoningObjectKind;
  title: string;
  preview?: string;
  phase?: ReasoningObjectPhase;
  status?: ReasoningObjectStatus;
  confidence?: number;
  sourceLabel?: string;
  searchParts?: Array<string | undefined>;
  classification: {
    confidence: ReasoningClassificationConfidence;
    reason: string;
    missingSignals?: string[];
  };
  metadata?: Record<string, unknown>;
  provenance?: ReasoningObjectProvenanceItem[];
  evidence?: ReasoningObjectEvidenceItem[];
}): ReasoningObjectNode {
  return {
    id: params.id,
    kind: params.kind,
    title: params.title,
    preview: params.preview ?? params.title,
    phase: params.phase,
    status: params.status ?? 'default',
    confidence: params.confidence,
    sourceLabel: params.sourceLabel,
    tags: ['synthetic-artifact'],
    searchText: [
      params.title,
      params.preview,
      ...(params.searchParts ?? [])
    ]
      .filter(Boolean)
      .join(' '),
    classification: {
      kind: params.kind,
      confidence: params.classification.confidence,
      reason: params.classification.reason,
      missingSignals: params.classification.missingSignals ?? []
    },
    metadata: {
      rawType: 'synthetic-artifact',
      derivedFromIds: [],
      compareKey: nodeCompareKey(params.kind, params.title),
      extra: {
        syntheticArtifact: true,
        ...(params.metadata ?? {})
      }
    },
    provenance: params.provenance ?? [],
    evidence: params.evidence ?? []
  };
}

function makeSyntheticEdge(params: {
  id: string;
  from: string;
  to: string;
  kind: ReasoningObjectEdge['kind'];
  phase?: ReasoningObjectPhase;
  status?: ReasoningObjectStatus;
  confidence?: number;
  rationale?: string;
  evidenceSources?: string[];
}): ReasoningObjectEdge {
  return {
    id: params.id,
    from: params.from,
    to: params.to,
    kind: params.kind,
    phase: params.phase,
    status: params.status ?? 'default',
    confidence: params.confidence,
    rationale: params.rationale,
    metadata: {
      derivedFromIds: [],
      evidenceSources: params.evidenceSources ?? [],
      compareKey: edgeCompareKey(params.kind, params.from, params.to),
      extra: {
        syntheticArtifact: true
      }
    },
    provenance: [],
    evidence: (params.evidenceSources ?? []).map((source, index) => ({
      id: `${params.id}:source:${index}`,
      kind: 'trace',
      label: 'Attributed source',
      summary: source,
      confidence: params.confidence
    }))
  };
}

function buildSyntheticArtifacts(params: {
  graph: ReasoningObjectSnapshot['graph'];
  meta: GraphSnapshotMeta | null;
  traceContext: SophiaReasoningObjectContext;
}): {
  nodes: ReasoningObjectNode[];
  edges: ReasoningObjectEdge[];
  notes: string[];
} {
  const nodes: ReasoningObjectNode[] = [];
  const edges: ReasoningObjectEdge[] = [];
  const notes: string[] = [];
  const nodeIds = new Set(params.graph.nodes.map((node) => node.id));
  const edgeIds = new Set(params.graph.edges.map((edge) => edge.id));

  const addNode = (node: ReasoningObjectNode): void => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };

  const addEdge = (edge: ReasoningObjectEdge): void => {
    if (edgeIds.has(edge.id)) return;
    edgeIds.add(edge.id);
    edges.push(edge);
  };

  const graphNodes = [...params.graph.nodes];
  const synthesisNodeIds = graphNodes
    .filter((node) => node.phase === 'synthesis' && node.kind !== 'source')
    .map((node) => node.id);
  const retrievalNodeIds = graphNodes
    .filter((node) => node.phase === 'retrieval' && node.kind !== 'source')
    .map((node) => node.id);
  const claimNodeIdsByPhase = {
    analysis: graphNodes
      .filter((node) => node.phase === 'analysis' && node.kind !== 'source')
      .map((node) => node.id),
    critique: graphNodes
      .filter((node) => node.phase === 'critique' && node.kind !== 'source')
      .map((node) => node.id),
    synthesis: synthesisNodeIds
  };

  let queryNodeId: string | null = null;
  if (params.traceContext.queryText?.trim() || params.meta?.query_run_id) {
    queryNodeId = artifactId('query', params.meta?.query_run_id ?? params.traceContext.queryText);
    addNode(
      makeSyntheticNode({
        id: queryNodeId,
        kind: 'query',
        title: 'User query',
        preview: params.traceContext.queryText?.trim()
          ? clip(params.traceContext.queryText.trim(), 140)
          : 'Current workspace query context',
        phase: 'retrieval',
        classification: {
          confidence: params.traceContext.queryText?.trim() ? 'high' : 'medium',
          reason: 'Derived directly from run query context carried into the Graph Kit workspace.',
          missingSignals: params.traceContext.queryText?.trim()
            ? []
            : ['The full query text is missing; only query-run context is available.']
        },
        metadata: {
          queryRunId: params.meta?.query_run_id,
          queryLength: params.traceContext.queryText?.trim().length ?? 0
        },
        provenance: params.meta?.query_run_id
          ? [
              {
                id: artifactId('prov', params.meta.query_run_id, 'query'),
                kind: 'provenance-id-only',
                label: 'Query run',
                value: params.meta.query_run_id,
                queryRunId: params.meta.query_run_id,
                sourceRefs: [{ kind: 'provenance-id-only', value: params.meta.query_run_id }]
              }
            ]
          : [],
        searchParts: [params.traceContext.queryText ?? undefined]
      })
    );
  }

  let retrievalNodeId: string | null = null;
  if (params.meta?.retrievalTrace) {
    const trace = params.meta.retrievalTrace;
    retrievalNodeId = artifactId('inference', params.meta.query_run_id ?? 'current', 'retrieval');
    addNode(
      makeSyntheticNode({
        id: retrievalNodeId,
        kind: 'inference',
        title: 'Retrieval compilation',
        preview: 'Query decomposition, seed selection, and traversal parameters compiled into the retrieval context.',
        phase: 'retrieval',
        status: params.meta.retrievalDegraded ? 'unresolved' : 'verified',
        confidence: trace.selectedSeedCount > 0 ? 0.78 : 0.5,
        classification: {
          confidence: 'high',
          reason: 'Derived from retrieval-trace metadata already present on the SOPHIA graph snapshot.'
        },
        metadata: {
          queryRunId: params.meta.query_run_id,
          selectedSeedCount: trace.selectedSeedCount,
          seedPoolCount: trace.seedPoolCount,
          traversalMode: trace.traversalMode ?? 'n/a',
          traversalMaxHops: trace.traversalMaxHops ?? null,
          contextSufficiency: params.meta.contextSufficiency ?? 'unknown'
        },
        evidence: [
          {
            id: `${retrievalNodeId}:seed-pool`,
            kind: 'trace',
            label: 'Seed selection',
            summary: `${trace.selectedSeedCount} of ${trace.seedPoolCount} seed candidates selected.`,
            confidence: 0.78
          },
          {
            id: `${retrievalNodeId}:traversal`,
            kind: 'trace',
            label: 'Traversal',
            summary: `${trace.relationKeptCount}/${trace.relationCandidateCount} relations kept across ${trace.traversedClaimCount} traversed claims.`,
            confidence: 0.74
          }
        ]
      })
    );

    if (queryNodeId) {
      addEdge(
        makeSyntheticEdge({
          id: artifactId('edge', queryNodeId, retrievalNodeId, 'responds-to'),
          from: queryNodeId,
          to: retrievalNodeId,
          kind: 'responds-to',
          phase: 'retrieval',
          confidence: 0.82,
          rationale: 'The retrieval compilation node summarizes how SOPHIA framed and expanded the user query.'
        })
      );
    }

    if (retrievalNodeIds.length > 0) {
      addEdge(
        makeSyntheticEdge({
          id: artifactId('edge', retrievalNodeId, retrievalNodeIds[0], 'supports'),
          from: retrievalNodeId,
          to: retrievalNodeIds[0],
          kind: 'supports',
          phase: 'retrieval',
          confidence: 0.7,
          rationale: 'This retrieval compilation state produced the current retrieval-layer graph neighborhood.'
        })
      );
    }
  }

  let closureNodeId: string | null = null;
  if (params.meta?.retrievalTrace?.closureStats) {
    const closure = params.meta.retrievalTrace.closureStats;
    closureNodeId = artifactId('inference', params.meta.query_run_id ?? 'current', 'closure');
    addNode(
      makeSyntheticNode({
        id: closureNodeId,
        kind: 'inference',
        title: 'Closure synthesis',
        preview: 'Closure units and thesis construction prepared synthesis-stage reasoning.',
        phase: 'synthesis',
        status: closure.capLimitedUnits > 0 ? 'unresolved' : 'default',
        confidence: closure.unitsCompleted > 0 ? 0.76 : 0.58,
        classification: {
          confidence: 'medium',
          reason: 'Derived from closure stats in retrieval trace metadata, which are a real precursor to synthesis.'
        },
        metadata: {
          unitsAttempted: closure.unitsAttempted,
          unitsCompleted: closure.unitsCompleted,
          claimsAddedForClosure: closure.claimsAddedForClosure,
          objectionsAdded: closure.objectionsAdded,
          repliesAdded: closure.repliesAdded,
          capLimitedUnits: closure.capLimitedUnits
        }
      })
    );

    if (retrievalNodeId) {
      addEdge(
        makeSyntheticEdge({
          id: artifactId('edge', retrievalNodeId, closureNodeId, 'inferred-by'),
          from: retrievalNodeId,
          to: closureNodeId,
          kind: 'inferred-by',
          phase: 'synthesis',
          confidence: 0.72,
          rationale: 'Closure synthesis was produced from the compiled retrieval context.'
        })
      );
    }

    for (const nodeId of synthesisNodeIds.slice(0, 8)) {
      addEdge(
        makeSyntheticEdge({
          id: artifactId('edge', closureNodeId, nodeId, 'supports'),
          from: closureNodeId,
          to: nodeId,
          kind: 'supports',
          phase: 'synthesis',
          confidence: 0.68,
          rationale: 'Closure synthesis contributes to the current synthesis-layer reasoning nodes.'
        })
      );
    }
  }

  let conclusionNodeId: string | null = null;
  if (params.traceContext.finalOutputText?.trim()) {
    const overallScore = params.traceContext.reasoningQuality?.overall_score;
    conclusionNodeId = artifactId('conclusion', params.meta?.query_run_id ?? params.traceContext.finalOutputText);
    addNode(
      makeSyntheticNode({
        id: conclusionNodeId,
        kind: 'conclusion',
        title: 'Final conclusion',
        preview: clip(params.traceContext.finalOutputText.trim(), 180),
        phase: 'synthesis',
        status:
          typeof overallScore === 'number' && overallScore >= 0.82
            ? 'verified'
            : typeof overallScore === 'number' && overallScore < 0.58
              ? 'unresolved'
              : 'default',
        confidence: overallScore,
        classification: {
          confidence: params.traceContext.finalOutputText.trim() ? 'high' : 'medium',
          reason: 'Derived from the final answer text captured for the run, separate from intermediate synthesis claims.',
          missingSignals: [
            'This conclusion node is compiled from the final output text because SOPHIA does not yet emit a first-class conclusion node.'
          ]
        },
        metadata: {
          outputLength: params.traceContext.finalOutputText.trim().length,
          queryRunId: params.meta?.query_run_id
        },
        provenance: params.meta?.query_run_id
          ? [
              {
                id: artifactId('prov', params.meta.query_run_id, 'conclusion'),
                kind: 'provenance-id-only',
                label: 'Run conclusion',
                value: params.meta.query_run_id,
                queryRunId: params.meta.query_run_id,
                sourceRefs: [{ kind: 'provenance-id-only', value: params.meta.query_run_id }]
              }
            ]
          : []
      })
    );

    for (const nodeId of synthesisNodeIds.slice(0, 8)) {
      addEdge(
        makeSyntheticEdge({
          id: artifactId('edge', nodeId, conclusionNodeId, 'supports'),
          from: nodeId,
          to: conclusionNodeId,
          kind: 'supports',
          phase: 'synthesis',
          confidence: 0.74,
          rationale: 'Synthesis-stage graph nodes feed into the captured final conclusion.'
        })
      );
    }

    if (!synthesisNodeIds.length && queryNodeId) {
      addEdge(
        makeSyntheticEdge({
          id: artifactId('edge', queryNodeId, conclusionNodeId, 'responds-to'),
          from: queryNodeId,
          to: conclusionNodeId,
          kind: 'responds-to',
          phase: 'synthesis',
          confidence: 0.66,
          rationale: 'The final conclusion is the direct output currently retained for the run.'
        })
      );
    }
  }

  const groundingByPass = new Map<string, GroundingSource[]>();
  for (const source of params.traceContext.groundingSources ?? []) {
    const passSources = groundingByPass.get(source.pass) ?? [];
    if (!passSources.some((existing) => existing.url === source.url && existing.pass === source.pass)) {
      passSources.push(source);
      groundingByPass.set(source.pass, passSources);
    }
  }

  for (const [pass, sources] of groundingByPass) {
    const phase = toReasoningPhase(pass as 'analysis' | 'critique' | 'synthesis' | 'verification');
    if (!phase) continue;

    const hubId =
      pass === 'verification'
        ? artifactId('inference', params.meta?.query_run_id ?? 'current', 'validation-review')
        : artifactId('inference', params.meta?.query_run_id ?? 'current', `${pass}-grounding`);
    const title = pass === 'verification' ? 'Validation review' : `${pass[0].toUpperCase()}${pass.slice(1)} evidence`;
    const overallScore = params.traceContext.reasoningQuality?.overall_score;

    addNode(
      makeSyntheticNode({
        id: hubId,
        kind: 'inference',
        title,
        preview:
          pass === 'verification'
            ? 'Verification and evaluation artefacts attached to the run.'
            : `Grounding sources captured for the ${pass} pass.`,
        phase,
        status:
          pass === 'verification'
            ? typeof overallScore === 'number' && overallScore >= 0.82
              ? 'verified'
              : 'unresolved'
            : 'default',
        confidence: pass === 'verification' ? overallScore : 0.72,
        classification: {
          confidence: 'medium',
          reason:
            pass === 'verification'
              ? 'Compiled from pass-level verification artefacts and reasoning-quality signals already stored by SOPHIA.'
              : 'Compiled from pass-level grounding source URLs captured during the run.'
        },
        metadata: {
          pass,
          groundingSourceCount: sources.length
        },
        evidence: sources.slice(0, 12).map((source, index) => ({
          id: `${hubId}:grounding:${index}`,
          kind: 'trace',
          label: 'Grounding source',
          summary: source.url,
          sourceTitle: source.title
        }))
      })
    );

    const targetNodeIds =
      pass === 'verification'
        ? conclusionNodeId
          ? [conclusionNodeId]
          : synthesisNodeIds
        : claimNodeIdsByPhase[phase as 'analysis' | 'critique' | 'synthesis'];

    for (const nodeId of targetNodeIds.slice(0, 8)) {
      addEdge(
        makeSyntheticEdge({
          id: artifactId('edge', hubId, nodeId, pass === 'verification' ? 'qualifies' : 'supports'),
          from: hubId,
          to: nodeId,
          kind: pass === 'verification' ? 'qualifies' : 'supports',
          phase,
          confidence: pass === 'verification' ? overallScore : 0.69,
          rationale:
            pass === 'verification'
              ? 'Verification artefacts qualify the confidence of the run output at pass level rather than claim-by-claim.'
              : `This hub represents pass-level grounding sources for ${pass}. It should not be read as claim-level citation certainty.`
        })
      );
    }

    if (!targetNodeIds.length && queryNodeId) {
      addEdge(
        makeSyntheticEdge({
          id: artifactId('edge', queryNodeId, hubId, 'responds-to'),
          from: queryNodeId,
          to: hubId,
          kind: 'responds-to',
          phase,
          confidence: 0.64,
          rationale: `The ${pass} artefact was captured as part of answering the current query.`
        })
      );
    }

    for (const source of sources.slice(0, 12)) {
      const evidenceNodeId = artifactId('evidence', pass, source.url);
      addNode(
        makeSyntheticNode({
          id: evidenceNodeId,
          kind: 'evidence',
          title: describeExternalResource(source.title, source.url),
          preview: source.url,
          phase,
          sourceLabel: source.title,
          classification: {
            confidence: 'high',
            reason: 'Derived from grounding source URLs explicitly captured during the SOPHIA run.',
            missingSignals: [
              'Grounding sources are currently attributed at pass level, not mapped to individual claims.'
            ]
          },
          metadata: {
            pass,
            url: source.url,
            title: source.title ?? null
          },
          provenance: [
            {
              id: `${evidenceNodeId}:url`,
              kind: 'url',
              label: 'Grounding URL',
              value: source.url,
              pass: phase,
              queryRunId: params.meta?.query_run_id,
              sourceRefs: [{ kind: 'url', value: source.url }]
            }
          ],
          evidence: [
            {
              id: `${evidenceNodeId}:summary`,
              kind: 'quote',
              label: 'Grounding record',
              summary: source.url,
              sourceTitle: source.title
            }
          ],
          searchParts: [source.title, source.url]
        })
      );

      addEdge(
        makeSyntheticEdge({
          id: artifactId('edge', evidenceNodeId, hubId, 'cites'),
          from: evidenceNodeId,
          to: hubId,
          kind: 'cites',
          phase,
          confidence: 0.85,
          rationale:
            pass === 'verification'
              ? 'This external grounding source informed the verification surface for the run.'
              : `This external grounding source was captured during the ${pass} pass.`,
          evidenceSources: [source.url]
        })
      );
    }

    if (sources.length > 12) {
      notes.push(
        `${sources.length - 12} additional ${pass} grounding sources are retained in SOPHIA data but omitted from the canvas to keep the workspace usable.`
      );
    }
  }

  if ((params.traceContext.sources?.length ?? 0) > 0) {
    const existingSourceTitles = new Set(
      [...graphNodes, ...nodes]
        .filter((node) => node.kind === 'source')
        .map((node) => normalize(node.title))
    );

    for (const source of (params.traceContext.sources ?? []).slice(0, 8)) {
      const normalizedTitle = normalize(source.title);
      if (existingSourceTitles.has(normalizedTitle)) continue;
      existingSourceTitles.add(normalizedTitle);

      const sourceNodeId = artifactId('source', source.id, source.title);
      addNode(
        makeSyntheticNode({
          id: sourceNodeId,
          kind: 'source',
          title: source.title,
          preview: `${source.author.join(', ') || 'Unknown author'} • ${source.claimCount} claims`,
          status: source.groundingConfidence?.score && source.groundingConfidence.score >= 0.8 ? 'verified' : 'default',
          confidence: source.groundingConfidence?.score,
          classification: {
            confidence: 'high',
            reason: 'Derived from the source-reference bundle already held in SOPHIA for the current run.'
          },
          metadata: {
            sourceId: source.id,
            claimCount: source.claimCount,
            authors: source.author,
            supportingUris: source.groundingConfidence?.supportingUris ?? []
          },
          provenance: [
            {
              id: `${sourceNodeId}:record`,
              kind: 'source-record',
              label: 'Source record',
              value: source.id,
              queryRunId: params.meta?.query_run_id,
              sourceRefs: [{ kind: 'source-record', value: source.id }]
            }
          ],
          evidence: (source.groundingConfidence?.supportingUris ?? []).slice(0, 4).map((uri, index) => ({
            id: `${sourceNodeId}:uri:${index}`,
            kind: 'source',
            label: 'Supporting URI',
            summary: uri,
            sourceTitle: source.title,
            confidence: source.groundingConfidence?.score
          }))
        })
      );

      if (queryNodeId) {
        addEdge(
          makeSyntheticEdge({
            id: artifactId('edge', sourceNodeId, queryNodeId, 'retrieved-from'),
            from: sourceNodeId,
            to: queryNodeId,
            kind: 'retrieved-from',
            phase: 'retrieval',
            confidence: source.groundingConfidence?.score,
            rationale: 'This source record was part of the run-level reference bundle available to the workspace.'
          })
        );
      }
    }
  }

  return { nodes, edges, notes };
}

function buildMissingDataNotes(
  nodes: ReasoningObjectNode[],
  meta: GraphSnapshotMeta | null,
  extraNotes: string[] = []
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
  for (const note of extraNotes) notes.add(note);

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
  const syntheticArtifacts = buildSyntheticArtifacts({
    graph: { nodes, edges, missingData: [] },
    meta,
    traceContext
  });
  const compiledNodes = [...nodes, ...syntheticArtifacts.nodes];
  const compiledNodesById = new Map(compiledNodes.map((node) => [node.id, node]));
  const compiledEdges = [
    ...edges,
    ...syntheticArtifacts.edges.map((edge) => ({
      ...edge,
      metadata: {
        ...edge.metadata,
        compareKey: edgeCompareKey(
          edge.kind,
          compiledNodesById.get(edge.from)?.title ?? edge.from,
          compiledNodesById.get(edge.to)?.title ?? edge.to
        )
      }
    }))
  ];
  const graph = {
    nodes: compiledNodes,
    edges: compiledEdges,
    missingData: buildMissingDataNotes(compiledNodes, meta, syntheticArtifacts.notes)
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
