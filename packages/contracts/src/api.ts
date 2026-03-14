import { z } from 'zod';
import type { ConstitutionalCheck } from './constitution';
import type { PhilosophicalDomain } from './domains';
import type { EssayFeedback, LearnEntitlementSummary, LessonUnit, ShortAnswerMiniReview, SkillScores } from './learn';
import type { PassType } from './passes';
import type { ModelProvider, ReasoningProvider } from './providers';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from './references';
import type { ReasoningEvaluation } from './verification';
import { SupportedDomainSchema } from './domains';
import { PassTypeSchema } from './passes';
import { ModelProviderSchema, ReasoningProviderSchema } from './providers';
import { AnalysisPhaseSchema, ClaimSchema, RelationBundleSchema, SourceReferenceSchema } from './references';

export const AnalyseDepthSchema = z.enum(['quick', 'standard', 'deep']);
export const ResourceModeSchema = z.enum(['standard', 'expanded']);
export const DomainModeSchema = z.enum(['auto', 'manual']);
export const GraphPhaseSchema = z.enum(['retrieval', 'analysis', 'critique', 'synthesis']);
export const GraphNodeTypeSchema = z.enum(['source', 'claim']);
export const GraphConflictStatusSchema = z.enum(['none', 'contested', 'unresolved', 'resolved']);
export const GraphEdgeTypeSchema = z.enum([
  'contains',
  'supports',
  'contradicts',
  'responds-to',
  'depends-on',
  'defines',
  'qualifies',
  'assumes',
  'resolves'
]);

export const GraphRejectionReasonCodeSchema = z.enum([
  'seed_pool_pruned',
  'duplicate_traversal',
  'duplicate_relation',
  'missing_endpoint',
  'confidence_gate',
  'source_integrity_gate'
]);

export const AnalyseRequestSchema = z.object({
  query: z.string().min(1),
  lens: z.string().min(1).optional(),
  depth: AnalyseDepthSchema.optional(),
  model_provider: ModelProviderSchema.optional(),
  model_id: z.string().min(1).optional(),
  domain_mode: DomainModeSchema.optional(),
  domain: SupportedDomainSchema.optional(),
  resource_mode: ResourceModeSchema.optional(),
  user_links: z.array(z.string().url()).optional(),
  link_preferences: z
    .array(
      z.object({
        url: z.string().url(),
        ingest_selected: z.boolean(),
        ingest_visibility: z.enum(['public_shared', 'private_user_only']),
        acknowledge_public_share: z.boolean().optional()
      })
    )
    .optional(),
  queue_for_nightly_ingest: z.boolean().optional(),
  reuse: z
    .object({
      from_depth: z.enum(['quick', 'standard']),
      analysis: z.string().min(1).optional(),
      critique: z.string().min(1).optional(),
      synthesis: z.string().min(1).optional()
    })
    .optional()
});

export type AnalyseRequest = z.infer<typeof AnalyseRequestSchema>;

export const PassSectionSchema = z.object({
  id: z.string().min(1),
  heading: z.string().min(1),
  content: z.string().min(1)
});

export interface PassStartEvent {
  type: 'pass_start';
  pass: PassType;
  model_provider?: ReasoningProvider;
  model_id?: string;
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

export type PassSection = z.infer<typeof PassSectionSchema>;

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
  selected_domain_mode?: 'auto' | 'manual';
  selected_domain?: 'ethics' | 'philosophy_of_mind';
  context_pack_stats?: {
    analysis: {
      token_budget: number;
      estimated_tokens: number;
      truncated: boolean;
      claim_count: number;
      relation_count: number;
      argument_count: number;
      reply_chain_count: number;
      unresolved_tension_count: number;
    };
    critique: {
      token_budget: number;
      estimated_tokens: number;
      truncated: boolean;
      claim_count: number;
      relation_count: number;
      argument_count: number;
      reply_chain_count: number;
      unresolved_tension_count: number;
    };
    synthesis: {
      token_budget: number;
      estimated_tokens: number;
      truncated: boolean;
      claim_count: number;
      relation_count: number;
      argument_count: number;
      reply_chain_count: number;
      unresolved_tension_count: number;
    };
  };
  depth_mode?: 'quick' | 'standard' | 'deep';
  selected_model_provider?: ModelProvider;
  selected_model_id?: string;
  resource_mode?: 'standard' | 'expanded';
  user_links_count?: number;
  runtime_links_processed?: number;
  nightly_queue_enqueued?: number;
  billing_tier?: 'free' | 'pro' | 'premium';
  billing_status?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';
  billing_currency?: 'GBP' | 'USD';
  entitlement_month_key?: string;
  ingestion_public_used?: number;
  ingestion_public_remaining?: number;
  ingestion_private_used?: number;
  ingestion_private_remaining?: number;
  ingestion_selected_count?: number;
  byok_wallet_currency?: 'GBP' | 'USD';
  byok_wallet_available_cents?: number;
  byok_fee_estimated_cents?: number;
  byok_fee_charged_cents?: number;
  byok_fee_charge_status?:
    | 'not_applicable'
    | 'pending'
    | 'shadow'
    | 'charged'
    | 'skipped'
    | 'insufficient';
  query_run_id?: string;
  model_cost_breakdown?: {
    total_estimated_cost_usd: number;
    by_model: Array<{
      provider: ReasoningProvider;
      model: string;
      passes: string[];
      input_tokens: number;
      output_tokens: number;
      input_cost_per_million: number;
      output_cost_per_million: number;
      estimated_cost_usd: number;
    }>;
  };
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

export const GroundingSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).optional(),
  pass: PassTypeSchema
});

export type GroundingSource = z.infer<typeof GroundingSourceSchema>;

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

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: GraphNodeTypeSchema,
  label: z.string().min(1),
  phase: GraphPhaseSchema.optional(),
  domain: z.string().min(1).optional(),
  sourceTitle: z.string().min(1).optional(),
  traversalDepth: z.number().int().min(0).optional(),
  relevance: z.number().min(0).max(1).optional(),
  isSeed: z.boolean().optional(),
  isTraversed: z.boolean().optional(),
  confidenceBand: z.enum(['high', 'medium', 'low']).optional(),
  depth_level: z.number().int().min(0).optional(),
  evidence_strength: z.number().min(0).max(1).optional(),
  novelty_score: z.number().min(0).max(1).optional(),
  derived_from: z.array(z.string().min(1)).optional(),
  pass_origin: GraphPhaseSchema.optional(),
  conflict_status: GraphConflictStatusSchema.optional(),
  unresolved_tension_id: z.string().min(1).optional(),
  provenance_id: z.string().min(1).optional()
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: GraphEdgeTypeSchema,
  weight: z.number().optional(),
  phaseOrigin: GraphPhaseSchema.optional(),
  depth_level: z.number().int().min(0).optional(),
  evidence_strength: z.number().min(0).max(1).optional(),
  novelty_score: z.number().min(0).max(1).optional(),
  derived_from: z.array(z.string().min(1)).optional(),
  pass_origin: GraphPhaseSchema.optional(),
  conflict_status: GraphConflictStatusSchema.optional(),
  unresolved_tension_id: z.string().min(1).optional(),
  provenance_id: z.string().min(1).optional(),
  relation_rationale: z.string().min(1).optional(),
  relation_confidence: z.number().min(0).max(1).optional(),
  evidence_count: z.number().int().min(0).optional(),
  evidence_sources: z.array(z.string().min(1)).optional()
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export type GraphRejectionReasonCode = z.infer<typeof GraphRejectionReasonCodeSchema>;

export const GraphGhostNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  reasonCode: GraphRejectionReasonCodeSchema,
  consideredIn: z.enum(['seed_pool', 'traversal', 'relations']).optional(),
  sourceTitle: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  anchorNodeId: z.string().min(1).optional(),
  pass_origin: GraphPhaseSchema.optional()
});

export type GraphGhostNode = z.infer<typeof GraphGhostNodeSchema>;

export const GraphGhostEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: GraphEdgeTypeSchema,
  reasonCode: GraphRejectionReasonCodeSchema,
  relation_confidence: z.number().min(0).max(1).optional(),
  rationale_source: z.string().min(1).optional(),
  pass_origin: GraphPhaseSchema.optional()
});

export type GraphGhostEdge = z.infer<typeof GraphGhostEdgeSchema>;

export interface GraphSnapshotMeta {
  seedNodeIds?: string[];
  traversedNodeIds?: string[];
  relationTypeCounts?: Partial<Record<GraphEdge['type'], number>>;
  maxHops?: number;
  contextSufficiency?: 'strong' | 'moderate' | 'sparse';
  retrievalDegraded?: boolean;
  retrievalDegradedReason?: string;
  retrievalTimestamp?: string;
  retrievalTrace?: {
    seedPoolCount: number;
    selectedSeedCount: number;
    hybridMode?: 'auto' | 'dense_only';
    denseSeedCount?: number;
    lexicalSeedCount?: number;
    lexicalTerms?: string[];
    corpusLevelQuery?: boolean;
    seedBalanceStats?: {
      selectionStrategy: 'mmr_quota_v1';
      mmrLambda: number;
      roleCountsPool: {
        support: number;
        objection: number;
        reply: number;
        definitionDistinction: number;
      };
      roleCountsSelected: {
        support: number;
        objection: number;
        reply: number;
        definitionDistinction: number;
      };
      roleQuotas: {
        support: number;
        objection: number;
        reply: number;
        definitionDistinction: number;
      };
      quotaSatisfiedRoles: string[];
      avgPairwiseSimilarityBefore: number;
      avgPairwiseSimilarityAfter: number;
      objectionReplyPresenceBefore: boolean;
      objectionReplyPresenceAfter: boolean;
      monoPerspectiveBefore: boolean;
      monoPerspectiveAfter: boolean;
    };
    traversalMode?: 'beam_trusted_v1';
    traversalMaxHops?: number;
    traversalHopDecay?: number;
    traversalBaseConfidenceThreshold?: number;
    traversalConfidenceThresholds?: number[];
    traversalDomainAware?: boolean;
    traversalTrustedEdgesOnly?: boolean;
    traversalEdgePriors?: Partial<Record<string, number>>;
    queryDecomposition?: {
      focusMode: 'corpus_overview' | 'focused';
      domainFilter?: PhilosophicalDomain;
      hybridMode: 'auto' | 'dense_only';
      corpusLevelQuery: boolean;
      lexicalTerms: string[];
      lexicalTermCount: number;
    };
    seedClaims?: Array<{
      id: string;
      claimType: string;
      domain: PhilosophicalDomain;
      sourceTitle: string;
      confidence: number;
    }>;
    pruningSummary?: {
      claimsByReason: {
        seed_pool_pruned: number;
        duplicate_traversal: number;
        confidence_gate: number;
        source_integrity_gate: number;
      };
      relationsByReason: {
        duplicate_relation: number;
        missing_endpoint: number;
      };
    };
    traversedClaimCount: number;
    relationCandidateCount: number;
    relationKeptCount: number;
    argumentCandidateCount: number;
    argumentKeptCount: number;
    closureStats?: {
      majorThesisCount: number;
      unitsAttempted: number;
      unitsCompleted: number;
      claimsAddedForClosure: number;
      objectionsAdded: number;
      repliesAdded: number;
      capLimitedUnits: number;
    };
    rejectedClaimCount?: number;
    rejectedRelationCount?: number;
  };
  rejectedNodes?: GraphGhostNode[];
  rejectedEdges?: GraphGhostEdge[];
  snapshot_id?: string;
  query_run_id?: string;
  parent_snapshot_id?: string;
  pass_sequence?: number;
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

export interface EnrichmentStatusEvent {
  type: 'enrichment_status';
  status: 'suppressed' | 'staged' | 'promoted' | 'failed';
  reason?: string;
  stagedCount?: number;
  promotedCount?: number;
  queryRunId?: string;
}

export interface ReasoningQualityEvent {
  type: 'reasoning_quality';
  reasoning_quality: ReasoningEvaluation;
}

export interface ConstitutionDeltaEvent {
  type: 'constitution_delta';
  pass: 'analysis' | 'critique' | 'synthesis';
  introduced_violations: string[];
  resolved_violations: string[];
  unresolved_violations: string[];
  overall_compliance: 'pass' | 'partial' | 'fail';
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
  | ConstitutionCheckEvent
  | EnrichmentStatusEvent
  | ReasoningQualityEvent
  | ConstitutionDeltaEvent;

export interface LearnLessonsResponse {
  lessons: LessonUnit[];
  next_cursor: number | null;
}

export interface LearnLessonResponse {
  lesson: LessonUnit;
}

export interface LearnShortReviewResponse {
  submission_id: string;
  word_count: number;
  review: ShortAnswerMiniReview;
  learn_entitlements?: LearnEntitlementSummary;
}

export interface LearnEssayReviewResponse {
  submission_id: string;
  version_number: number;
  word_count: number;
  feedback: EssayFeedback;
  learn_entitlements?: LearnEntitlementSummary;
  used_scholar_credit?: boolean;
}

export interface LearnProgressResponse {
  skills: SkillScores;
  recommendation: string;
  trajectory_delta: number;
  completed_units: string[];
  essay_count: number;
  recent_scores: number[];
  learn_entitlements?: LearnEntitlementSummary;
}
