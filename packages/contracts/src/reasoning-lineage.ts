import { z } from 'zod';
import {
  RESTORMEL_CONTRACTS_SCHEMA_VERSION,
  RestormelContractsSchemaVersionSchema,
  type RestormelContractsSchemaVersion
} from './schema-version';
import {
  ReasoningObjectKindSchema,
  ReasoningObjectPhaseSchema,
  ReasoningObjectSourceRefKindSchema,
  ReasoningObjectStatusSchema
} from './reasoning-object';

export const ReasoningLineageReportVersionSchema = z.object({
  schemaVersion: RestormelContractsSchemaVersionSchema.default(
    RESTORMEL_CONTRACTS_SCHEMA_VERSION
  ),
  artifactVersion: z.literal(1).default(1)
});

export interface ReasoningLineageReportVersion {
  schemaVersion: RestormelContractsSchemaVersion;
  artifactVersion: 1;
}

export const ReasoningLineageRunRefSchema = z.object({
  source: z.enum(['sophia-graph-snapshot', 'sophia-reference-graph', 'adapter']),
  runId: z.string().min(1).optional(),
  queryRunId: z.string().min(1).optional(),
  snapshotId: z.string().min(1).optional(),
  parentSnapshotId: z.string().min(1).optional(),
  passSequence: z.number().int().min(0).optional(),
  generatedAt: z.string().min(1).optional()
});

export type ReasoningLineageRunRef = z.infer<typeof ReasoningLineageRunRefSchema>;

export const ReasoningLineageReasoningSummarySchema = z.object({
  topLine: z.string().min(1),
  nodeCount: z.number().int().min(0),
  edgeCount: z.number().int().min(0),
  claimCount: z.number().int().min(0),
  evidenceBackedClaimCount: z.number().int().min(0),
  contradictionCount: z.number().int().min(0),
  outputCount: z.number().int().min(0),
  evaluationFindingCount: z.number().int().min(0)
});

export type ReasoningLineageReasoningSummary = z.infer<
  typeof ReasoningLineageReasoningSummarySchema
>;

export const ReasoningLineageJustificationItemSchema = z.object({
  compareKey: z.string().min(1),
  objectId: z.string().min(1).optional(),
  title: z.string().min(1),
  kind: ReasoningObjectKindSchema,
  phase: ReasoningObjectPhaseSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidenceCount: z.number().int().min(0),
  provenanceCount: z.number().int().min(0),
  supportEdgeCount: z.number().int().min(0),
  contradictionEdgeCount: z.number().int().min(0),
  primaryEvidence: z.string().min(1).optional(),
  rationale: z.string().min(1).optional()
});

export type ReasoningLineageJustificationItem = z.infer<
  typeof ReasoningLineageJustificationItemSchema
>;

export const ReasoningLineageContradictionItemSchema = z.object({
  compareKey: z.string().min(1),
  objectId: z.string().min(1).optional(),
  title: z.string().min(1),
  status: ReasoningObjectStatusSchema,
  contradictionEdgeCount: z.number().int().min(0),
  supportEdgeCount: z.number().int().min(0),
  note: z.string().min(1)
});

export type ReasoningLineageContradictionItem = z.infer<
  typeof ReasoningLineageContradictionItemSchema
>;

export const ReasoningLineageProvenanceItemSchema = z.object({
  provenanceId: z.string().min(1),
  kind: ReasoningObjectSourceRefKindSchema,
  label: z.string().min(1),
  value: z.string().min(1),
  pass: ReasoningObjectPhaseSchema.optional(),
  queryRunId: z.string().min(1).optional(),
  usageCount: z.number().int().min(0),
  objectIds: z.array(z.string().min(1)),
  sourceRefs: z.array(
    z.object({
      kind: ReasoningObjectSourceRefKindSchema,
      value: z.string().min(1)
    })
  )
});

export type ReasoningLineageProvenanceItem = z.infer<
  typeof ReasoningLineageProvenanceItemSchema
>;

export const ReasoningLineageCompareSummarySchema = z.object({
  summary: z.string().min(1),
  addedClaims: z.number().int().min(0),
  removedClaims: z.number().int().min(0),
  evidenceDeltaCount: z.number().int().min(0),
  provenanceDeltaCount: z.number().int().min(0),
  contradictionChangeCount: z.number().int().min(0),
  supportStrengthChangeCount: z.number().int().min(0),
  outputChangeCount: z.number().int().min(0),
  notes: z.array(z.string().min(1))
});

export type ReasoningLineageCompareSummary = z.infer<
  typeof ReasoningLineageCompareSummarySchema
>;

export const ReasoningLineageReportSchema = z.object({
  version: ReasoningLineageReportVersionSchema,
  generatedAt: z.string().min(1),
  title: z.string().min(1),
  run: ReasoningLineageRunRefSchema,
  reasoningSummary: ReasoningLineageReasoningSummarySchema,
  justifications: z.array(ReasoningLineageJustificationItemSchema),
  contradictions: z.array(ReasoningLineageContradictionItemSchema),
  provenanceBundle: z.object({
    totalItems: z.number().int().min(0),
    uniqueSourceRefs: z.number().int().min(0),
    missingProvenanceCount: z.number().int().min(0),
    items: z.array(ReasoningLineageProvenanceItemSchema)
  }),
  compareSummary: ReasoningLineageCompareSummarySchema.optional(),
  notes: z.array(z.string().min(1))
});

export type ReasoningLineageReport = z.infer<typeof ReasoningLineageReportSchema>;
