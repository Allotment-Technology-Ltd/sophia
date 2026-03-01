import type { PassType } from './passes';
import type { AnalysisPhase, Claim, RelationBundle } from './references';

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

export type SSEEvent =
  | PassStartEvent
  | PassChunkEvent
  | PassCompleteEvent
  | MetadataEvent
  | ErrorEvent
  | ClaimsEvent
  | RelationsEvent;
