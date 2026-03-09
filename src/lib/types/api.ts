import type { PassType } from './passes';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from './references';
import type { ConstitutionalCheck } from './constitution';

export interface AnalyseRequest {
  query: string;
  lens?: string;
  depth?: 'quick' | 'standard' | 'deep';
}

export interface PassStartEvent {
  type: 'pass_start';
  pass: PassType;
}

export interface PassChunkEvent {
  type: 'pass_chunk';
  pass: PassType;
  content: string;
}

export interface PassCompleteEvent {
  type: 'pass_complete';
  pass: PassType;
}

export interface PassSection {
  id: string;
  heading: string;
  content: string;
}

export interface PassStructuredEvent {
  type: 'pass_structured';
  pass: PassType;
  sections: PassSection[];
  wordCount: number;
}

export interface MetadataEvent {
  type: 'metadata';
  total_input_tokens: number;
  total_output_tokens: number;
  duration_ms: number;
  claims_retrieved?: number;
  arguments_retrieved?: number;
  retrieval_degraded?: boolean;
  retrieval_degraded_reason?: string;
  detected_domain?: string;
  domain_confidence?: 'high' | 'medium' | 'low';
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export interface ClaimsEvent {
  type: 'claims';
  pass: AnalysisPhase;
  claims: Claim[];
}

export interface RelationsEvent {
  type: 'relations';
  pass: AnalysisPhase;
  relations: RelationBundle[];
}

export interface SourcesEvent {
  type: 'sources';
  sources: SourceReference[];
}

export interface GroundingSource {
  url: string;
  title?: string;
  pass: PassType;
}

export interface GroundingSourcesEvent {
  type: 'grounding_sources';
  pass: PassType;
  sources: GroundingSource[];
}

export interface ConfidenceSummaryEvent {
  type: 'confidence_summary';
  avgConfidence: number;
  lowConfidenceCount: number;
  totalClaims: number;
}

export interface GraphNode {
  id: string;
  type: 'source' | 'claim';
  label: string;
  phase?: 'retrieval' | 'analysis' | 'critique' | 'synthesis';
  domain?: string;
  sourceTitle?: string;
  traversalDepth?: number;
  relevance?: number;
  isSeed?: boolean;
  isTraversed?: boolean;
  confidenceBand?: 'high' | 'medium' | 'low';
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'contains' | 'supports' | 'contradicts' | 'responds-to' | 'depends-on';
  weight?: number;
  phaseOrigin?: 'retrieval' | 'analysis' | 'critique' | 'synthesis';
}

export interface GraphSnapshotMeta {
  seedNodeIds?: string[];
  traversedNodeIds?: string[];
  relationTypeCounts?: Partial<Record<GraphEdge['type'], number>>;
  maxHops?: number;
  contextSufficiency?: 'strong' | 'moderate' | 'sparse';
  retrievalDegraded?: boolean;
  retrievalDegradedReason?: string;
  retrievalTimestamp?: string;
}

export interface GraphSnapshotEvent {
  type: 'graph_snapshot';
  nodes: GraphNode[];
  edges: GraphEdge[];
  version?: number;
  meta?: GraphSnapshotMeta;
}

export interface ConstitutionCheckEvent {
  type: 'constitution_check';
  constitutional_check: ConstitutionalCheck;
}

export type SSEEvent =
  | PassStartEvent
  | PassChunkEvent
  | PassCompleteEvent
  | PassStructuredEvent
  | MetadataEvent
  | ErrorEvent
  | ClaimsEvent
  | RelationsEvent
  | SourcesEvent
  | GroundingSourcesEvent
  | ConfidenceSummaryEvent
  | GraphSnapshotEvent
  | ConstitutionCheckEvent;
