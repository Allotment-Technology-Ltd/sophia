/**
 * Shared types for the ingestion pipeline stages.
 *
 * These types are used across all stages and by the orchestrator (scripts/ingest.ts).
 * Stage-specific types remain in their respective modules.
 */

import type { ExtractionClaim } from '$lib/server/prompts/extraction.js';
import type { Relation } from '$lib/server/prompts/relations.js';
import type { GroupingOutput } from '$lib/server/prompts/grouping.js';
import type { ValidationOutput } from '$lib/server/prompts/validation.js';
import type { PassageRecord, PhaseOneClaimMetadata, PhaseOneRelationMetadata } from '../contracts.js';
import type { IngestionStagePlan } from '$lib/server/aaif/ingestion-plan.js';

export type PhaseOneClaim = ExtractionClaim & PhaseOneClaimMetadata;
export type PhaseOneRelation = Relation & PhaseOneRelationMetadata;

export type StageKey =
	| 'extraction'
	| 'relations'
	| 'grouping'
	| 'validation'
	| 'remediation'
	| 'embedding'
	| 'json_repair';

export interface StageBudget {
	maxInputTokens?: number;
	maxOutputTokens?: number;
	maxUsd?: number;
	maxRetries: number;
	timeoutMs: number;
}

export interface StageUsageTracker {
	stage: StageKey;
	startInputTokens: number;
	startOutputTokens: number;
	startUsd: number;
	retries: number;
}

export interface CostTracker {
	totalInputTokens: number;
	totalOutputTokens: number;
	vertexChars: number;
	totalUsd: number;
}

export interface IngestTimingPayload {
	planning_initial_ms: number;
	planning_post_extraction_ms: number;
	planning_post_relations_ms: number;
	stage_ms: Record<string, number>;
	model_calls: Record<string, number>;
	model_call_wall_ms: Record<string, number>;
	model_retries: number;
	retry_backoff_ms_total: number;
	batch_splits: number;
	json_repair_invocations: number;
	embed_wall_ms: number;
	store_wall_ms: number;
}

export interface SourceMeta {
	title: string;
	author: string[];
	year?: number;
	source_type: string;
	url: string;
	canonical_url?: string;
	canonical_url_hash?: string;
	visibility_scope?: string;
	deletion_state?: string;
	fetched_at: string;
	word_count: number;
	char_count: number;
	estimated_tokens: number;
}

export interface PartialResults {
	source: SourceMeta;
	claims?: PhaseOneClaim[];
	relations?: PhaseOneRelation[];
	arguments?: GroupingOutput;
	embeddings?: number[][];
	validation?: ValidationOutput | null;
	stage_completed: string;
	cost_usd_snapshot?: number;
	extraction_progress?: {
		claims_so_far: PhaseOneClaim[];
		remaining_batches?: PassageRecord[][];
		remaining_sections?: string[];
	};
	grouping_progress?: {
		grouped_outputs_so_far: GroupingOutput[];
		next_batch_index: number;
		total_batches: number;
	};
	validation_progress?: {
		batch_outputs_so_far: ValidationOutput[];
		next_batch_index: number;
		total_batches: number;
		should_validate: boolean;
	};
	/** Mid-remediation checkpoint (ordered positions to repair; resume index). */
	remediation_progress?: {
		positions: number[];
		next_index: number;
	};
	relations_progress?: {
		relations_so_far: PhaseOneRelation[];
		next_batch_index: number;
		total_batches: number;
	};
	embedding_progress?: {
		embeddings_so_far: number[][];
		next_index: number;
	};
}

export interface ValidationBatch {
	claims: PhaseOneClaim[];
	relations: PhaseOneRelation[];
	arguments: GroupingOutput;
	sourceText: string;
	estimatedPromptTokens: number;
}

export interface GroupingBatch {
	claims: PhaseOneClaim[];
	relations: PhaseOneRelation[];
}

export interface ValidationBatchExecContext {
	validationPlan: IngestionStagePlan;
	validationBudget: StageBudget;
	validationTracker: StageUsageTracker;
	jsonRepairPlan: IngestionStagePlan;
	jsonRepairBudget: StageBudget;
	repairTracker: StageUsageTracker;
	relations: PhaseOneRelation[];
	arguments_: GroupingOutput;
	sourceText: string;
	sourceTitle: string;
}

export interface IngestionLogRecord {
	id?: string;
	source_url: string;
	source_title: string;
	status: string;
	started_at: string;
	completed_at?: string;
	claim_count?: number;
	relation_count?: number;
	argument_count?: number;
	model_chain?: Record<string, string>;
	error_message?: string;
}
