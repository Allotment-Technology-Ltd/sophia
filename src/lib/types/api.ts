import type { PassType } from './passes';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from './references';

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
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'contains' | 'supports' | 'contradicts' | 'responds-to' | 'depends-on';
}

export interface GraphSnapshotEvent {
  type: 'graph_snapshot';
  nodes: GraphNode[];
  edges: GraphEdge[];
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
  | ConfidenceSummaryEvent
  | GraphSnapshotEvent;
