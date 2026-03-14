import { z } from 'zod';
import {
  RESTORMEL_CONTRACTS_SCHEMA_VERSION,
  RestormelContractsSchemaVersionSchema,
  type RestormelContractsSchemaVersion
} from './schema-version';

export const TraceIngestionSourceSchema = z.enum([
  'sophia-sse',
  'sophia-run-trace',
  'opentelemetry',
  'openinference',
  'adapter'
]);

export type TraceIngestionSource = z.infer<typeof TraceIngestionSourceSchema>;

export const TraceIngestionPhaseSchema = z.enum([
  'retrieval',
  'analysis',
  'critique',
  'synthesis',
  'verification'
]);

export type TraceIngestionPhase = z.infer<typeof TraceIngestionPhaseSchema>;

export const NormalizedTraceStatusSchema = z.enum(['ok', 'error', 'warning', 'unknown']);

export type NormalizedTraceStatus = z.infer<typeof NormalizedTraceStatusSchema>;

export const NormalizedTraceSpanKindSchema = z.enum([
  'run',
  'pass',
  'retrieval',
  'reasoning',
  'verification',
  'tool',
  'unknown'
]);

export type NormalizedTraceSpanKind = z.infer<typeof NormalizedTraceSpanKindSchema>;

export const NormalizedTraceEventKindSchema = z.enum([
  'run-start',
  'run-complete',
  'pass-start',
  'pass-complete',
  'pass-structured',
  'graph-snapshot',
  'claims-emitted',
  'relations-emitted',
  'sources-emitted',
  'grounding-sources-emitted',
  'confidence-summary',
  'metadata',
  'reasoning-quality',
  'constitution-delta',
  'constitution-check',
  'verification-complete',
  'extraction-complete',
  'error',
  'annotation'
]);

export type NormalizedTraceEventKind = z.infer<typeof NormalizedTraceEventKindSchema>;

export const TraceProducerSchema = z.object({
  ecosystem: TraceIngestionSourceSchema,
  name: z.string().min(1),
  version: z.string().min(1).optional(),
  transport: z.string().min(1).optional()
});

export type TraceProducer = z.infer<typeof TraceProducerSchema>;

export const TraceObjectReferenceSchema = z.object({
  kind: z.enum(['node', 'edge', 'claim', 'source', 'output', 'run']),
  id: z.string().min(1)
});

export type TraceObjectReference = z.infer<typeof TraceObjectReferenceSchema>;

export const NormalizedTraceSpanSchema = z.object({
  id: z.string().min(1),
  traceId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  name: z.string().min(1),
  kind: NormalizedTraceSpanKindSchema,
  phase: TraceIngestionPhaseSchema.optional(),
  status: NormalizedTraceStatusSchema.default('unknown'),
  startTime: z.string().min(1),
  endTime: z.string().min(1).optional(),
  attributes: z.record(z.string(), z.unknown()).default({})
});

export type NormalizedTraceSpan = z.infer<typeof NormalizedTraceSpanSchema>;

export const NormalizedTraceEventSchema = z.object({
  id: z.string().min(1),
  traceId: z.string().min(1),
  spanId: z.string().min(1).optional(),
  parentSpanId: z.string().min(1).optional(),
  kind: NormalizedTraceEventKindSchema,
  name: z.string().min(1),
  timestamp: z.string().min(1),
  phase: TraceIngestionPhaseSchema.optional(),
  status: NormalizedTraceStatusSchema.default('unknown'),
  sequence: z.number().int().min(1),
  attributes: z.record(z.string(), z.unknown()).default({}),
  objectRefs: z.array(TraceObjectReferenceSchema).default([]),
  payloadSummary: z.string().min(1).optional()
});

export type NormalizedTraceEvent = z.infer<typeof NormalizedTraceEventSchema>;

export const NormalizedRunTraceSchema = z.object({
  schemaVersion: RestormelContractsSchemaVersionSchema.default(
    RESTORMEL_CONTRACTS_SCHEMA_VERSION
  ),
  source: TraceIngestionSourceSchema,
  producer: TraceProducerSchema,
  traceId: z.string().min(1),
  runId: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
  spans: z.array(NormalizedTraceSpanSchema),
  events: z.array(NormalizedTraceEventSchema),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export interface NormalizedRunTrace {
  schemaVersion: RestormelContractsSchemaVersion;
  source: TraceIngestionSource;
  producer: TraceProducer;
  traceId: string;
  runId?: string;
  query?: string;
  startedAt?: string;
  completedAt?: string;
  spans: NormalizedTraceSpan[];
  events: NormalizedTraceEvent[];
  metadata?: Record<string, unknown>;
}
