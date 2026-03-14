import { z } from 'zod';
import type {
  GraphEdge,
  GraphNode,
  GraphSnapshotMeta,
  SSEEvent
} from './api';
import {
  RESTORMEL_CONTRACTS_SCHEMA_VERSION,
  RestormelContractsSchemaVersionSchema,
  type RestormelContractsSchemaVersion
} from './schema-version';
import type {
  ExtractedClaim,
  ExtractedRelation,
  ExtractionMetadataSchema,
  ReasoningEvaluation,
  VerificationResult
} from './verification';

export const RunTraceSourceSchema = z.enum(['sse', 'cached', 'snapshot']);

export type RunTraceSource = z.infer<typeof RunTraceSourceSchema>;

export interface GraphSnapshot {
  version?: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: GraphSnapshotMeta;
}

export interface ExtractionCompleteEvent {
  type: 'extraction_complete';
  claims: ExtractedClaim[];
  relations: ExtractedRelation[];
  metadata: z.infer<typeof ExtractionMetadataSchema>;
}

export interface ReasoningScoresEvent {
  type: 'reasoning_scores';
  reasoning_quality: ReasoningEvaluation;
}

export interface VerificationCompleteEvent {
  type: 'verification_complete';
  result: VerificationResult;
}

export type ReasoningEvent =
  | SSEEvent
  | ExtractionCompleteEvent
  | ReasoningScoresEvent
  | VerificationCompleteEvent;

export interface RunTrace {
  schemaVersion: RestormelContractsSchemaVersion;
  source: RunTraceSource;
  runId?: string;
  query?: string;
  finalOutput?: string;
  startedAt?: string;
  completedAt?: string;
  events: ReasoningEvent[];
  snapshots: GraphSnapshot[];
  metadata?: Record<string, unknown>;
}

export const RunTraceSchema = z.object({
  schemaVersion: RestormelContractsSchemaVersionSchema.default(
    RESTORMEL_CONTRACTS_SCHEMA_VERSION
  ),
  source: RunTraceSourceSchema,
  runId: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  finalOutput: z.string().min(1).optional(),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
  events: z.array(z.object({ type: z.string().min(1) }).passthrough()),
  snapshots: z.array(
    z.object({
      version: z.number().int().positive().optional(),
      nodes: z.array(z.object({ id: z.string().min(1) }).passthrough()),
      edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) }).passthrough()),
      meta: z.object({}).passthrough().optional()
    })
  ),
  metadata: z.record(z.string(), z.unknown()).optional()
});
