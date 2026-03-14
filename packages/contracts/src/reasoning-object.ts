import { z } from 'zod';
import { GraphPhaseSchema } from './api';
import {
  RESTORMEL_CONTRACTS_SCHEMA_VERSION,
  RestormelContractsSchemaVersionSchema,
  type RestormelContractsSchemaVersion
} from './schema-version';
import { ReasoningEvaluationSchema, type ReasoningEvaluation } from './verification';

export const ReasoningObjectPhaseSchema = GraphPhaseSchema;

export type ReasoningObjectPhase = z.infer<typeof ReasoningObjectPhaseSchema>;

export const ReasoningObjectKindSchema = z.enum([
  'query',
  'claim',
  'evidence',
  'source',
  'inference',
  'conclusion',
  'contradiction',
  'synthesis'
]);

export type ReasoningObjectKind = z.infer<typeof ReasoningObjectKindSchema>;

export const ReasoningRelationKindSchema = z.enum([
  'supports',
  'contradicts',
  'derived-from',
  'cites',
  'retrieved-from',
  'inferred-by',
  'unresolved',
  'contains',
  'responds-to',
  'depends-on',
  'defines',
  'qualifies',
  'assumes',
  'resolves'
]);

export type ReasoningRelationKind = z.infer<typeof ReasoningRelationKindSchema>;

export const ReasoningObjectStatusSchema = z.enum([
  'default',
  'verified',
  'unresolved',
  'contradicted',
  'dimmed'
]);

export type ReasoningObjectStatus = z.infer<typeof ReasoningObjectStatusSchema>;

export const ReasoningClassificationConfidenceSchema = z.enum(['high', 'medium', 'low']);

export type ReasoningClassificationConfidence = z.infer<
  typeof ReasoningClassificationConfidenceSchema
>;

export const ReasoningObjectTraceEventKindSchema = z.enum([
  'snapshot-captured',
  'query-received',
  'evidence-added',
  'claim-created',
  'inference-produced',
  'contradiction-detected',
  'validation-run',
  'synthesis-completed',
  'final-output-created',
  'enrichment-updated',
  'note'
]);

export type ReasoningObjectTraceEventKind = z.infer<typeof ReasoningObjectTraceEventKindSchema>;

export const ReasoningObjectTraceEventSourceSchema = z.enum([
  'run-stream',
  'snapshot-meta',
  'graph-derived',
  'placeholder'
]);

export type ReasoningObjectTraceEventSource = z.infer<
  typeof ReasoningObjectTraceEventSourceSchema
>;

export const ReasoningObjectTraceEventStatusSchema = z.enum([
  'complete',
  'active',
  'warning',
  'todo'
]);

export type ReasoningObjectTraceEventStatus = z.infer<
  typeof ReasoningObjectTraceEventStatusSchema
>;

export const ReasoningObjectSourceRefKindSchema = z.enum([
  'graph-claim',
  'url',
  'span',
  'source-record',
  'provenance-id-only'
]);

export type ReasoningObjectSourceRefKind = z.infer<typeof ReasoningObjectSourceRefKindSchema>;

export const ReasoningObjectEvidenceKindSchema = z.enum([
  'source',
  'relation-rationale',
  'trace',
  'quote',
  'derived-claim'
]);

export type ReasoningObjectEvidenceKind = z.infer<typeof ReasoningObjectEvidenceKindSchema>;

export const ReasoningObjectVersionSchema = z.object({
  schemaVersion: RestormelContractsSchemaVersionSchema.default(
    RESTORMEL_CONTRACTS_SCHEMA_VERSION
  ),
  source: z.enum(['sophia-graph-snapshot', 'sophia-reference-graph', 'adapter']),
  runId: z.string().min(1).optional(),
  queryRunId: z.string().min(1).optional(),
  snapshotId: z.string().min(1).optional(),
  parentSnapshotId: z.string().min(1).optional(),
  passSequence: z.number().int().min(0).optional(),
  generatedAt: z.string().min(1).optional()
});

export interface ReasoningObjectVersion {
  schemaVersion: RestormelContractsSchemaVersion;
  source: 'sophia-graph-snapshot' | 'sophia-reference-graph' | 'adapter';
  runId?: string;
  queryRunId?: string;
  snapshotId?: string;
  parentSnapshotId?: string;
  passSequence?: number;
  generatedAt?: string;
}

export const ReasoningObjectClassificationSchema = z.object({
  kind: ReasoningObjectKindSchema,
  confidence: ReasoningClassificationConfidenceSchema,
  reason: z.string().min(1),
  missingSignals: z.array(z.string().min(1))
});

export type ReasoningObjectClassification = z.infer<typeof ReasoningObjectClassificationSchema>;

export const ReasoningObjectConfidenceInputsSchema = z.object({
  extractionConfidence: z.number().min(0).max(1).optional(),
  sourceCredibility: z.number().min(0).max(1).optional(),
  corroborationCount: z.number().int().min(0).optional(),
  contradictionPressure: z.number().min(0).max(1).optional(),
  passAgreement: z.number().min(0).max(1).optional()
});

export type ReasoningObjectConfidenceInputs = z.infer<
  typeof ReasoningObjectConfidenceInputsSchema
>;

export const ReasoningObjectSourceRefSchema = z.object({
  kind: ReasoningObjectSourceRefKindSchema,
  value: z.string().min(1)
});

export type ReasoningObjectSourceRef = z.infer<typeof ReasoningObjectSourceRefSchema>;

export const ReasoningObjectProvenanceItemSchema = z.object({
  id: z.string().min(1),
  kind: ReasoningObjectSourceRefKindSchema,
  label: z.string().min(1),
  value: z.string().min(1),
  pass: ReasoningObjectPhaseSchema.optional(),
  timestamp: z.string().min(1).optional(),
  queryRunId: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  sourceRefs: z.array(ReasoningObjectSourceRefSchema),
  confidenceInputs: ReasoningObjectConfidenceInputsSchema.optional()
});

export type ReasoningObjectProvenanceItem = z.infer<
  typeof ReasoningObjectProvenanceItemSchema
>;

export const ReasoningObjectEvidenceItemSchema = z.object({
  id: z.string().min(1),
  kind: ReasoningObjectEvidenceKindSchema,
  label: z.string().min(1),
  summary: z.string().min(1),
  sourceTitle: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  relatedObjectId: z.string().min(1).optional(),
  provenanceId: z.string().min(1).optional()
});

export type ReasoningObjectEvidenceItem = z.infer<typeof ReasoningObjectEvidenceItemSchema>;

export const ReasoningObjectNodeMetadataSchema = z.object({
  rawType: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  sourceTitle: z.string().min(1).optional(),
  traversalDepth: z.number().int().min(0).optional(),
  relevance: z.number().min(0).max(1).optional(),
  confidenceBand: z.enum(['high', 'medium', 'low']).optional(),
  passOrigin: ReasoningObjectPhaseSchema.optional(),
  derivedFromIds: z.array(z.string().min(1)),
  unresolvedTensionId: z.string().min(1).optional(),
  provenanceId: z.string().min(1).optional(),
  noveltyScore: z.number().min(0).max(1).optional(),
  compareKey: z.string().min(1),
  extra: z.record(z.string(), z.unknown())
});

export type ReasoningObjectNodeMetadata = z.infer<typeof ReasoningObjectNodeMetadataSchema>;

export const ReasoningObjectEdgeMetadataSchema = z.object({
  passOrigin: ReasoningObjectPhaseSchema.optional(),
  depthLevel: z.number().int().min(0).optional(),
  derivedFromIds: z.array(z.string().min(1)),
  unresolvedTensionId: z.string().min(1).optional(),
  provenanceId: z.string().min(1).optional(),
  evidenceSources: z.array(z.string().min(1)),
  compareKey: z.string().min(1),
  extra: z.record(z.string(), z.unknown())
});

export type ReasoningObjectEdgeMetadata = z.infer<typeof ReasoningObjectEdgeMetadataSchema>;

export const ReasoningObjectNodeSchema = z.object({
  id: z.string().min(1),
  kind: ReasoningObjectKindSchema,
  title: z.string().min(1),
  preview: z.string().min(1).optional(),
  phase: ReasoningObjectPhaseSchema.optional(),
  status: ReasoningObjectStatusSchema,
  confidence: z.number().min(0).max(1).optional(),
  evidenceStrength: z.number().min(0).max(1).optional(),
  sourceLabel: z.string().min(1).optional(),
  isSeed: z.boolean().optional(),
  isTraversed: z.boolean().optional(),
  tags: z.array(z.string().min(1)),
  searchText: z.string().min(1),
  classification: ReasoningObjectClassificationSchema,
  metadata: ReasoningObjectNodeMetadataSchema,
  provenance: z.array(ReasoningObjectProvenanceItemSchema),
  evidence: z.array(ReasoningObjectEvidenceItemSchema)
});

export type ReasoningObjectNode = z.infer<typeof ReasoningObjectNodeSchema>;

export const ReasoningObjectEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: ReasoningRelationKindSchema,
  phase: ReasoningObjectPhaseSchema.optional(),
  status: ReasoningObjectStatusSchema,
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().min(1).optional(),
  evidenceCount: z.number().int().min(0).optional(),
  metadata: ReasoningObjectEdgeMetadataSchema,
  provenance: z.array(ReasoningObjectProvenanceItemSchema),
  evidence: z.array(ReasoningObjectEvidenceItemSchema)
});

export type ReasoningObjectEdge = z.infer<typeof ReasoningObjectEdgeSchema>;

export const ReasoningObjectTraceEventFocusSchema = z.object({
  primaryNodeId: z.string().min(1).optional(),
  relatedNodeIds: z.array(z.string().min(1)),
  edgeIds: z.array(z.string().min(1)).optional(),
  inspectorSection: z.enum(['summary', 'evidence', 'provenance', 'validation']).optional()
});

export type ReasoningObjectTraceEventFocus = z.infer<
  typeof ReasoningObjectTraceEventFocusSchema
>;

export const ReasoningObjectTraceEventSchema = z.object({
  id: z.string().min(1),
  kind: ReasoningObjectTraceEventKindSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  phase: ReasoningObjectPhaseSchema.optional(),
  status: ReasoningObjectTraceEventStatusSchema,
  source: ReasoningObjectTraceEventSourceSchema,
  sequence: z.number().int().min(1),
  timestamp: z.string().min(1).optional(),
  facts: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string().min(1)
    })
  ),
  focus: ReasoningObjectTraceEventFocusSchema.optional()
});

export type ReasoningObjectTraceEvent = z.infer<typeof ReasoningObjectTraceEventSchema>;

export const ReasoningObjectValidationDeltaSchema = z.object({
  phase: z.enum(['analysis', 'critique', 'synthesis']),
  introducedViolations: z.array(z.string().min(1)),
  resolvedViolations: z.array(z.string().min(1)),
  unresolvedViolations: z.array(z.string().min(1)),
  overallCompliance: z.enum(['pass', 'partial', 'fail'])
});

export type ReasoningObjectValidationDelta = z.infer<
  typeof ReasoningObjectValidationDeltaSchema
>;

export const ReasoningObjectGraphEvaluationSeveritySchema = z.enum(['info', 'warning', 'error']);

export type ReasoningObjectGraphEvaluationSeverity = z.infer<
  typeof ReasoningObjectGraphEvaluationSeveritySchema
>;

export const ReasoningObjectGraphEvaluationKindSchema = z.enum([
  'unsupported-claim',
  'claim-without-evidence',
  'contradiction-density',
  'missing-provenance',
  'weak-source-diversity',
  'unresolved-inference-chain',
  'conclusion-confidence-gap',
  'disconnected-justification-path'
]);

export type ReasoningObjectGraphEvaluationKind = z.infer<
  typeof ReasoningObjectGraphEvaluationKindSchema
>;

export const ReasoningObjectGraphEvaluationFindingSchema = z.object({
  id: z.string().min(1),
  kind: ReasoningObjectGraphEvaluationKindSchema,
  severity: ReasoningObjectGraphEvaluationSeveritySchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  nodeIds: z.array(z.string().min(1)),
  edgeIds: z.array(z.string().min(1)),
  metricValue: z.number().optional(),
  threshold: z.number().optional()
});

export type ReasoningObjectGraphEvaluationFinding = z.infer<
  typeof ReasoningObjectGraphEvaluationFindingSchema
>;

export const ReasoningObjectGraphEvaluationSummarySchema = z.object({
  overallStatus: z.enum(['ok', 'warning', 'error']),
  totalFindings: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  errorCount: z.number().int().min(0),
  topLine: z.string().min(1)
});

export type ReasoningObjectGraphEvaluationSummary = z.infer<
  typeof ReasoningObjectGraphEvaluationSummarySchema
>;

export const ReasoningObjectEvaluationSchema = z.object({
  overallScore: z.number().min(0).max(1).optional(),
  flaggedNodeIds: z.array(z.string().min(1)),
  reasoningQuality: ReasoningEvaluationSchema.optional(),
  validationDeltas: z.array(ReasoningObjectValidationDeltaSchema),
  notes: z.array(z.string().min(1)),
  graphSummary: ReasoningObjectGraphEvaluationSummarySchema.optional(),
  graphFindings: z.array(ReasoningObjectGraphEvaluationFindingSchema).default([])
});

export interface ReasoningObjectEvaluation {
  overallScore?: number;
  flaggedNodeIds: string[];
  reasoningQuality?: ReasoningEvaluation;
  validationDeltas: ReasoningObjectValidationDelta[];
  notes: string[];
  graphSummary?: ReasoningObjectGraphEvaluationSummary;
  graphFindings: ReasoningObjectGraphEvaluationFinding[];
}

export const ReasoningObjectOutputSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['synthesis', 'conclusion', 'final-output']),
  title: z.string().min(1),
  text: z.string().min(1),
  phase: ReasoningObjectPhaseSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  derivedNodeIds: z.array(z.string().min(1))
});

export type ReasoningObjectOutput = z.infer<typeof ReasoningObjectOutputSchema>;

export const ReasoningObjectGraphSchema = z.object({
  nodes: z.array(ReasoningObjectNodeSchema),
  edges: z.array(ReasoningObjectEdgeSchema),
  missingData: z.array(z.string().min(1))
});

export type ReasoningObjectGraph = z.infer<typeof ReasoningObjectGraphSchema>;

export const ReasoningObjectSnapshotSchema = z.object({
  version: ReasoningObjectVersionSchema,
  graph: ReasoningObjectGraphSchema,
  trace: z.array(ReasoningObjectTraceEventSchema),
  outputs: z.array(ReasoningObjectOutputSchema),
  evaluation: ReasoningObjectEvaluationSchema.optional()
});

export type ReasoningObjectSnapshot = z.infer<typeof ReasoningObjectSnapshotSchema>;
