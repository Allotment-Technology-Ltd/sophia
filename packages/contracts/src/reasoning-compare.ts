import { z } from 'zod';
import {
  ReasoningObjectKindSchema,
  ReasoningObjectOutputSchema,
  ReasoningObjectStatusSchema,
  ReasoningRelationKindSchema
} from './reasoning-object';

export const ReasoningObjectCompareEntityRefSchema = z.object({
  compareKey: z.string().min(1),
  objectId: z.string().min(1).optional(),
  title: z.string().min(1),
  kind: ReasoningObjectKindSchema.optional()
});

export type ReasoningObjectCompareEntityRef = z.infer<
  typeof ReasoningObjectCompareEntityRefSchema
>;

export const ReasoningObjectCompareEdgeRefSchema = z.object({
  compareKey: z.string().min(1),
  edgeId: z.string().min(1).optional(),
  kind: ReasoningRelationKindSchema,
  fromTitle: z.string().min(1),
  toTitle: z.string().min(1)
});

export type ReasoningObjectCompareEdgeRef = z.infer<typeof ReasoningObjectCompareEdgeRefSchema>;

export const ReasoningObjectCompareValueChangeSchema = z.object({
  compareKey: z.string().min(1),
  target: z.enum(['node', 'edge', 'output']),
  title: z.string().min(1),
  before: z.number().min(0).max(1).optional(),
  after: z.number().min(0).max(1).optional()
});

export type ReasoningObjectCompareValueChange = z.infer<
  typeof ReasoningObjectCompareValueChangeSchema
>;

export const ReasoningObjectContradictionChangeSchema = z.object({
  compareKey: z.string().min(1),
  title: z.string().min(1),
  before: z.union([ReasoningObjectStatusSchema, z.literal('missing')]),
  after: z.union([ReasoningObjectStatusSchema, z.literal('missing')]),
  beforeContradictionEdges: z.number().int().min(0).default(0),
  afterContradictionEdges: z.number().int().min(0).default(0)
});

export type ReasoningObjectContradictionChange = z.infer<
  typeof ReasoningObjectContradictionChangeSchema
>;

export const ReasoningObjectClaimDiffSchema = z.object({
  compareKey: z.string().min(1),
  title: z.string().min(1),
  kind: ReasoningObjectKindSchema,
  baselineNodeId: z.string().min(1).optional(),
  currentNodeId: z.string().min(1).optional(),
  baselineConfidence: z.number().min(0).max(1).optional(),
  currentConfidence: z.number().min(0).max(1).optional(),
  evidenceAdded: z.array(z.string().min(1)),
  evidenceRemoved: z.array(z.string().min(1)),
  provenanceAdded: z.array(z.string().min(1)),
  provenanceRemoved: z.array(z.string().min(1)),
  justificationPathAdded: z.array(z.string().min(1)),
  justificationPathRemoved: z.array(z.string().min(1)),
  baselineSupportEdgeCount: z.number().int().min(0).default(0),
  currentSupportEdgeCount: z.number().int().min(0).default(0),
  baselineContradictionEdgeCount: z.number().int().min(0).default(0),
  currentContradictionEdgeCount: z.number().int().min(0).default(0)
});

export type ReasoningObjectClaimDiff = z.infer<typeof ReasoningObjectClaimDiffSchema>;

export const ReasoningObjectEvidenceSetDiffSchema = z.object({
  ownerCompareKey: z.string().min(1),
  ownerTitle: z.string().min(1),
  addedEvidence: z.array(z.string().min(1)),
  removedEvidence: z.array(z.string().min(1))
});

export type ReasoningObjectEvidenceSetDiff = z.infer<
  typeof ReasoningObjectEvidenceSetDiffSchema
>;

export const ReasoningObjectProvenanceDiffSchema = z.object({
  ownerCompareKey: z.string().min(1),
  ownerTitle: z.string().min(1),
  addedProvenance: z.array(z.string().min(1)),
  removedProvenance: z.array(z.string().min(1))
});

export type ReasoningObjectProvenanceDiff = z.infer<
  typeof ReasoningObjectProvenanceDiffSchema
>;

export const ReasoningObjectJustificationPathDiffSchema = z.object({
  ownerCompareKey: z.string().min(1),
  ownerTitle: z.string().min(1),
  addedPaths: z.array(z.string().min(1)),
  removedPaths: z.array(z.string().min(1))
});

export type ReasoningObjectJustificationPathDiff = z.infer<
  typeof ReasoningObjectJustificationPathDiffSchema
>;

export const ReasoningObjectOutputDiffSchema = z.object({
  compareKey: z.string().min(1),
  kind: ReasoningObjectOutputSchema.shape.kind,
  title: z.string().min(1),
  baselineOutputId: z.string().min(1).optional(),
  currentOutputId: z.string().min(1).optional(),
  baselineConfidence: z.number().min(0).max(1).optional(),
  currentConfidence: z.number().min(0).max(1).optional(),
  textChanged: z.boolean(),
  derivedNodeIdsAdded: z.array(z.string().min(1)),
  derivedNodeIdsRemoved: z.array(z.string().min(1))
});

export type ReasoningObjectOutputDiff = z.infer<typeof ReasoningObjectOutputDiffSchema>;

export const ReasoningObjectSnapshotDiffSchema = z.object({
  addedNodes: z.array(ReasoningObjectCompareEntityRefSchema),
  removedNodes: z.array(ReasoningObjectCompareEntityRefSchema),
  addedClaims: z.array(ReasoningObjectCompareEntityRefSchema),
  removedClaims: z.array(ReasoningObjectCompareEntityRefSchema),
  addedEdges: z.array(ReasoningObjectCompareEdgeRefSchema),
  removedEdges: z.array(ReasoningObjectCompareEdgeRefSchema),
  changedConfidence: z.array(ReasoningObjectCompareValueChangeSchema),
  supportStrengthChanges: z.array(ReasoningObjectCompareValueChangeSchema),
  contradictionChanges: z.array(ReasoningObjectContradictionChangeSchema),
  claimDiffs: z.array(ReasoningObjectClaimDiffSchema),
  evidenceSetDiffs: z.array(ReasoningObjectEvidenceSetDiffSchema),
  provenanceDiffs: z.array(ReasoningObjectProvenanceDiffSchema),
  justificationPathDiffs: z.array(ReasoningObjectJustificationPathDiffSchema),
  outputDiffs: z.array(ReasoningObjectOutputDiffSchema),
  summary: z.string().min(1),
  notes: z.array(z.string().min(1))
});

export type ReasoningObjectSnapshotDiff = z.infer<typeof ReasoningObjectSnapshotDiffSchema>;
