import type { AnalysisPhase } from './references';
import type { GraphEdge, GraphNode } from './api';

export type DomainMode = 'auto' | 'manual';
export type SupportedDomain = 'ethics' | 'philosophy_of_mind';

export interface ProvenanceRecord {
  id: string;
  query_run_id: string;
  pass_id: AnalysisPhase | 'retrieval';
  timestamp: string;
  source_refs: Array<{
    kind: 'graph_claim' | 'url' | 'span';
    value: string;
  }>;
  rationale_text: string;
  confidence_inputs: {
    extraction_confidence?: number;
    source_credibility?: number;
    corroboration_count?: number;
    contradiction_pressure?: number;
    pass_agreement?: number;
  };
}

export interface EnrichmentCandidateNode extends GraphNode {
  provenance: ProvenanceRecord;
}

export interface EnrichmentCandidateEdge extends GraphEdge {
  provenance: ProvenanceRecord;
}

export interface StagingEnrichmentRecord {
  id: string;
  query_run_id: string;
  snapshot_id: string;
  status: 'staged' | 'suppressed' | 'promoted' | 'rejected';
  reason?: string;
  nodes: EnrichmentCandidateNode[];
  edges: EnrichmentCandidateEdge[];
  created_at: string;
}

export interface EnrichmentRunResult {
  status: 'suppressed' | 'staged' | 'promoted' | 'failed';
  reason?: string;
  stagedCount: number;
  promotedCount: number;
  queryRunId: string;
  snapshotId: string;
  parentSnapshotId?: string;
  snapshotNodes?: GraphNode[];
  snapshotEdges?: GraphEdge[];
}
