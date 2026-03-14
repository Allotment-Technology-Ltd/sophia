export type GraphKitPhase = 'retrieval' | 'analysis' | 'critique' | 'synthesis';
export type GraphKitFocusMode = 'global' | 'local-dim' | 'local-isolate';
export type GraphKitNeighborhoodDepth = 1 | 2 | 3;
export type GraphKitInspectorSectionFocus = 'evidence' | 'provenance' | 'validation';

export type GraphKitNodeKind =
  | 'query'
  | 'claim'
  | 'evidence'
  | 'source'
  | 'inference'
  | 'conclusion'
  | 'contradiction'
  | 'synthesis';

export type GraphKitEdgeKind =
  | 'supports'
  | 'contradicts'
  | 'derived-from'
  | 'cites'
  | 'retrieved-from'
  | 'inferred-by'
  | 'unresolved'
  | 'contains'
  | 'responds-to'
  | 'depends-on'
  | 'defines'
  | 'qualifies'
  | 'assumes'
  | 'resolves';

export type GraphKitEntityStatus =
  | 'default'
  | 'verified'
  | 'unresolved'
  | 'contradicted'
  | 'dimmed';

export type GraphKitClassificationConfidence = 'high' | 'medium' | 'low';

export type GraphKitMetadataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | number[];

export interface GraphKitNodeMetadata {
  // Raw-source hints are retained so adapters can be incremental and reversible.
  rawType?: string;
  domain?: string;
  sourceTitle?: string;
  traversalDepth?: number;
  relevance?: number;
  confidenceBand?: 'high' | 'medium' | 'low';
  passOrigin?: GraphKitPhase;
  derivedFromIds: string[];
  unresolvedTensionId?: string;
  provenanceId?: string;
  noveltyScore?: number;
  taxonomyReason: string;
  taxonomyConfidence: GraphKitClassificationConfidence;
  missingSignals: string[];
  extra: Record<string, GraphKitMetadataValue>;
}

export interface GraphKitProvenanceSourceRef {
  kind: 'graph-claim' | 'url' | 'span' | 'source-record' | 'provenance-id-only';
  value: string;
}

export interface GraphKitProvenanceItem {
  id: string;
  kind: GraphKitProvenanceSourceRef['kind'];
  label: string;
  value: string;
  pass?: GraphKitPhase;
  timestamp?: string;
  queryRunId?: string;
  rationale?: string;
  sourceRefs: GraphKitProvenanceSourceRef[];
  confidenceInputs?: {
    extractionConfidence?: number;
    sourceCredibility?: number;
    corroborationCount?: number;
    contradictionPressure?: number;
    passAgreement?: number;
  };
}

export interface GraphKitEvidenceItem {
  id: string;
  kind: 'source' | 'relation-rationale' | 'trace' | 'quote' | 'derived-claim';
  label: string;
  summary: string;
  sourceTitle?: string;
  confidence?: number;
  relatedNodeId?: string;
  provenanceId?: string;
}

export interface GraphKitEdgeMetadata {
  passOrigin?: GraphKitPhase;
  depthLevel?: number;
  derivedFromIds: string[];
  unresolvedTensionId?: string;
  provenanceId?: string;
  evidenceSources: string[];
  extra: Record<string, GraphKitMetadataValue>;
}

export interface GraphKitNode {
  id: string;
  kind: GraphKitNodeKind;
  title: string;
  preview?: string;
  phase?: GraphKitPhase;
  status: GraphKitEntityStatus;
  confidence?: number;
  evidenceStrength?: number;
  sourceLabel?: string;
  isSeed?: boolean;
  isTraversed?: boolean;
  tags: string[];
  searchText: string;
  metadata: GraphKitNodeMetadata;
  provenance: GraphKitProvenanceItem[];
  evidence: GraphKitEvidenceItem[];
}

export interface GraphKitEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphKitEdgeKind;
  phase?: GraphKitPhase;
  status: GraphKitEntityStatus;
  confidence?: number;
  rationale?: string;
  evidenceCount?: number;
  metadata: GraphKitEdgeMetadata;
  provenance: GraphKitProvenanceItem[];
  evidence: GraphKitEvidenceItem[];
}

export interface GraphKitGhostNode {
  id: string;
  title: string;
  kind: 'candidate';
  reasonCode:
    | 'seed_pool_pruned'
    | 'duplicate_traversal'
    | 'duplicate_relation'
    | 'missing_endpoint'
    | 'confidence_gate'
    | 'source_integrity_gate';
  phase?: GraphKitPhase;
  sourceTitle?: string;
  confidence?: number;
  anchorNodeId?: string;
}

export interface GraphKitGhostEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphKitEdgeKind;
  reasonCode: GraphKitGhostNode['reasonCode'];
  phase?: GraphKitPhase;
  confidence?: number;
  rationale?: string;
}

export interface GraphKitInspectorSection {
  title: string;
  rows: Array<{ label: string; value: string }>;
}

export interface GraphKitInspectorAction {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface GraphKitInspectorRelationItem {
  id: string;
  title: string;
  kind: 'support' | 'contradiction';
  confidence?: number;
  rationale?: string;
}

export interface GraphKitInspectorPayload {
  target: 'workspace' | 'node' | 'edge';
  title: string;
  subtitle?: string;
  badges?: string[];
  summary?: string;
  confidence?: number;
  sourceBadges?: string[];
  sections: GraphKitInspectorSection[];
  provenance?: GraphKitProvenanceItem[];
  evidence?: GraphKitEvidenceItem[];
  supportRelations?: GraphKitInspectorRelationItem[];
  contradictionRelations?: GraphKitInspectorRelationItem[];
  validationNotes?: string[];
  actions?: GraphKitInspectorAction[];
  todo?: string[];
}

export type GraphKitTraceEventKind =
  | 'snapshot-captured'
  | 'query-received'
  | 'evidence-added'
  | 'claim-created'
  | 'inference-produced'
  | 'contradiction-detected'
  | 'validation-run'
  | 'synthesis-completed'
  | 'final-output-created'
  | 'enrichment-updated'
  | 'note';

export type GraphKitTraceEventSource =
  | 'sophia-stream'
  | 'snapshot-meta'
  | 'graph-derived'
  | 'placeholder';

export type GraphKitTracePlaybackMode = 'snapshot-only' | 'event-focus' | 'full-replay';

export interface GraphKitTraceEventFocus {
  primaryNodeId?: string;
  relatedNodeIds: string[];
  edgeIds?: string[];
  inspectorSection?: 'summary' | 'evidence' | 'provenance' | 'validation';
}

export interface GraphKitTracePlaybackHint {
  replayable: boolean;
  mode: GraphKitTracePlaybackMode;
  missingCapabilities: string[];
}

export interface GraphKitTraceEvent {
  id: string;
  kind: GraphKitTraceEventKind;
  title: string;
  summary: string;
  phase?: GraphKitPhase;
  status: 'complete' | 'active' | 'warning' | 'todo';
  source: GraphKitTraceEventSource;
  sequence: number;
  timestamp?: string;
  facts: Array<{ label: string; value: string }>;
  focus?: GraphKitTraceEventFocus;
  playback: GraphKitTracePlaybackHint;
}

export interface GraphKitCompareResult {
  baselineRun: {
    label: string;
    query?: string;
    queryRunId?: string;
    timestamp?: string;
  };
  currentRun: {
    label: string;
    query?: string;
    queryRunId?: string;
    timestamp?: string;
  };
  baselineGraph: {
    label: string;
    snapshotId?: string;
    parentSnapshotId?: string;
    passSequence?: number;
    nodeCount: number;
    edgeCount: number;
  };
  currentGraph: {
    label: string;
    snapshotId?: string;
    parentSnapshotId?: string;
    passSequence?: number;
    nodeCount: number;
    edgeCount: number;
  };
  addedNodes: Array<{
    signature: string;
    nodeId: string;
    title: string;
    kind: GraphKitNodeKind;
  }>;
  removedNodes: Array<{
    signature: string;
    nodeId: string;
    title: string;
    kind: GraphKitNodeKind;
  }>;
  addedEdges: Array<{
    signature: string;
    edgeId: string;
    kind: GraphKitEdgeKind;
    fromTitle: string;
    toTitle: string;
  }>;
  removedEdges: Array<{
    signature: string;
    edgeId: string;
    kind: GraphKitEdgeKind;
    fromTitle: string;
    toTitle: string;
  }>;
  changedConfidence: Array<{
    signature: string;
    target: 'node' | 'edge';
    title: string;
    before?: number;
    after?: number;
  }>;
  contradictionChanges: Array<{
    signature: string;
    title: string;
    before: GraphKitEntityStatus | 'missing';
    after: GraphKitEntityStatus | 'missing';
  }>;
  claimComparisons: Array<{
    signature: string;
    title: string;
    baselineNodeId?: string;
    currentNodeId?: string;
    baselineConfidence?: number;
    currentConfidence?: number;
    evidenceAdded: string[];
    evidenceRemoved: string[];
  }>;
  evidenceSetComparisons: Array<{
    ownerSignature: string;
    ownerTitle: string;
    addedEvidence: string[];
    removedEvidence: string[];
  }>;
  summary: string;
  todo: string[];
}

export interface GraphKitWorkspaceSummary {
  title: string;
  subtitle: string;
  metrics: Array<{ label: string; value: string }>;
  warnings: string[];
}

export interface GraphKitScopeSummary {
  active: boolean;
  visibleNodes: number;
  totalNodes: number;
  visibleEdges: number;
  totalEdges: number;
}

export interface GraphKitTracePlaybackDescriptor {
  mode: GraphKitTracePlaybackMode;
  canReplay: boolean;
  hasEventSelection: boolean;
  missingCapabilities: string[];
  todo: string[];
}

export interface GraphKitGraphViewModel {
  nodes: GraphKitNode[];
  edges: GraphKitEdge[];
  ghostNodes: GraphKitGhostNode[];
  ghostEdges: GraphKitGhostEdge[];
  compareResult?: GraphKitCompareResult | null;
  missingData: string[];
}

export interface GraphKitWorkspaceData {
  summary: GraphKitWorkspaceSummary;
  graph: GraphKitGraphViewModel;
  traceEvents: GraphKitTraceEvent[];
  playback: GraphKitTracePlaybackDescriptor;
}

export interface GraphKitWorkspaceFilters {
  search: string;
  phase: 'all' | GraphKitPhase;
  density: 'comfortable' | 'dense';
  nodeKinds: Set<GraphKitNodeKind>;
  edgeKinds: Set<GraphKitEdgeKind>;
  showGhosts: boolean;
}
