import { z } from 'zod';
import { AnalysisPhaseSchema, type AnalysisPhase } from './references';
import { GraphEdgeSchema, GraphNodeSchema, type GraphEdge, type GraphNode } from './api';
import { SupportedDomainSchema, type SupportedDomain } from './domains';

export const EnrichmentDomainModeSchema = z.enum(['auto', 'manual']);
export type DomainMode = z.infer<typeof EnrichmentDomainModeSchema>;
export type { SupportedDomain };

export const ProvenanceSourceRefSchema = z.object({
  kind: z.enum(['graph_claim', 'url', 'span']),
  value: z.string().min(1)
});

export const ProvenanceRecordSchema = z.object({
  id: z.string().min(1),
  query_run_id: z.string().min(1),
  pass_id: z.union([AnalysisPhaseSchema, z.literal('retrieval')]),
  timestamp: z.string().min(1),
  source_refs: z.array(ProvenanceSourceRefSchema),
  rationale_text: z.string().min(1),
  confidence_inputs: z.object({
    extraction_confidence: z.number().min(0).max(1).optional(),
    source_credibility: z.number().min(0).max(1).optional(),
    corroboration_count: z.number().int().min(0).optional(),
    contradiction_pressure: z.number().min(0).max(1).optional(),
    pass_agreement: z.number().min(0).max(1).optional()
  })
});

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

export const EnrichmentCandidateNodeSchema = GraphNodeSchema.extend({
  provenance: ProvenanceRecordSchema
});

export interface EnrichmentCandidateNode extends GraphNode {
  provenance: ProvenanceRecord;
}

export const EnrichmentCandidateEdgeSchema = GraphEdgeSchema.extend({
  provenance: ProvenanceRecordSchema
});

export interface EnrichmentCandidateEdge extends GraphEdge {
  provenance: ProvenanceRecord;
}

export const StagingEnrichmentRecordSchema = z.object({
  id: z.string().min(1),
  query_run_id: z.string().min(1),
  snapshot_id: z.string().min(1),
  status: z.enum(['staged', 'suppressed', 'promoted', 'rejected']),
  reason: z.string().min(1).optional(),
  nodes: z.array(EnrichmentCandidateNodeSchema),
  edges: z.array(EnrichmentCandidateEdgeSchema),
  created_at: z.string().min(1)
});

export type StagingEnrichmentRecord = z.infer<typeof StagingEnrichmentRecordSchema>;

export const EnrichmentRunResultSchema = z.object({
  status: z.enum(['suppressed', 'staged', 'promoted', 'failed']),
  reason: z.string().min(1).optional(),
  stagedCount: z.number().int().min(0),
  promotedCount: z.number().int().min(0),
  queryRunId: z.string().min(1),
  snapshotId: z.string().min(1),
  parentSnapshotId: z.string().min(1).optional(),
  snapshotNodes: z.array(GraphNodeSchema).optional(),
  snapshotEdges: z.array(GraphEdgeSchema).optional()
});

export type EnrichmentRunResult = z.infer<typeof EnrichmentRunResultSchema>;
