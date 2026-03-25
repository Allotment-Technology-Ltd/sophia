/**
 * SOPHIA — Main Ingestion Pipeline
 *
 * Processes a philosophical source through the complete pipeline:
 * Extract → Relate → Group → Embed → Validate → Store
 *
 * Usage: npx tsx --env-file=.env scripts/ingest.ts <source-file-path> [--validate]
 *
 * The source-file-path should be a .txt file in data/sources/ with a matching .meta.json
 *
 * Resume: The pipeline is automatically resumable. If a previous run failed or was
 * interrupted, re-running with the same source will pick up where it left off.
 * Progress is tracked in the ingestion_log table in SurrealDB.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Surreal } from 'surrealdb';
import { generateText } from 'ai';
import { estimateCost as estimateRestormelCost, defaultProviders } from '@restormel/keys';
import { embedTexts, EMBEDDING_DIMENSIONS } from '../src/lib/server/embeddings.js';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.js';
import { z } from 'zod';
import {
	planIngestionStage,
	type IngestionStagePlan,
	type IngestProviderPreference
} from '../src/lib/server/aaif/ingestion-plan.js';
import { startSpinner } from './progress.js';

// ─── Prompt imports (relative paths for standalone script) ─────────────────
import {
	EXTRACTION_SYSTEM,
	EXTRACTION_USER,
	ExtractionOutputSchema,
	type ExtractionClaim,
	type ExtractionOutput
} from '../src/lib/server/prompts/extraction.js';

import {
	RELATIONS_SYSTEM,
	RELATIONS_USER,
	RelationsOutputSchema,
	type Relation,
	type RelationsOutput
} from '../src/lib/server/prompts/relations.js';

import {
	GROUPING_SYSTEM,
	GROUPING_USER,
	GroupingOutputSchema,
	type Argument,
	type GroupingOutput
} from '../src/lib/server/prompts/grouping.js';

import {
	VALIDATION_SYSTEM,
	VALIDATION_USER,
	normalizeValidationOutput,
	type ValidationOutput
} from '../src/lib/server/prompts/validation.js';
import {
	buildPassageBatches,
	renderPassageBatch,
	segmentArgumentativePassages
} from '../src/lib/server/ingestion/passageSegmentation.js';
import { deriveClaimTypingMetadata } from '../src/lib/server/ingestion/claimTyping.js';
import type {
	PassageRecord,
	PhaseOneClaimMetadata,
	PhaseOneRelationMetadata,
	ReviewState
} from '../src/lib/server/ingestion/contracts.js';

// ─── Configuration ─────────────────────────────────────────────────────────
const INGEST_PROVIDER_DEFAULT = (process.env.INGEST_PROVIDER || 'auto').toLowerCase();

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';
const GOOGLE_VERTEX_PROJECT = process.env.GOOGLE_VERTEX_PROJECT || process.env.GCP_PROJECT_ID || '';
const GOOGLE_VERTEX_LOCATION = process.env.GOOGLE_VERTEX_LOCATION || process.env.GCP_LOCATION || 'us-central1';
const DB_CONNECT_MAX_RETRIES = Number(process.env.DB_CONNECT_MAX_RETRIES || '4');
const DB_CONNECT_RETRY_BASE_MS = Number(process.env.DB_CONNECT_RETRY_BASE_MS || '750');
const INGEST_MODEL_TIMEOUT_MS = Number(process.env.INGEST_MODEL_TIMEOUT_MS || '180000');
const VALIDATION_MODEL_TIMEOUT_MS = Number(process.env.VALIDATION_MODEL_TIMEOUT_MS || '180000');

const INGESTED_DIR = './data/ingested';
const INGEST_EXTRACTOR_VERSION =
	process.env.INGEST_EXTRACTOR_VERSION || 'phase1-passage-grounding-v1';
const LOW_CONFIDENCE_REVIEW_THRESHOLD = Number(
	process.env.INGEST_LOW_CONFIDENCE_REVIEW_THRESHOLD || '0.65'
);
// Keep sections small enough that Claude's extraction output fits within max_tokens (32768).
// Each claim is ~150 tokens of JSON. At 10 claims/1k input tokens:
//   5_000 tokens input → ~50 claims → ~7_500 tokens output → fits in 32768 limit with safety margin.
const MAX_TOKENS_PER_SECTION = Number(process.env.INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION || '5000');
const BOOK_MAX_TOKENS_PER_SECTION = Number(process.env.BOOK_MAX_TOKENS_PER_SECTION || '3000');
const GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS =
	parsePositiveInt(process.env.GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS) ?? 100_000;
const GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER = Math.max(
	1,
	Number(process.env.GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER || '2.2')
);
const VALIDATION_BATCH_TARGET_TOKENS =
	parsePositiveInt(process.env.VALIDATION_BATCH_TARGET_TOKENS) ?? 100_000;
const VALIDATION_BATCH_SOURCE_MAX_CHARS =
	parsePositiveInt(process.env.VALIDATION_BATCH_SOURCE_MAX_CHARS) ?? 24_000;
const VALIDATION_BATCH_SOURCE_CONTEXT_CHARS =
	parsePositiveInt(process.env.VALIDATION_BATCH_SOURCE_CONTEXT_CHARS) ?? 800;
const VALIDATION_TOKEN_ESTIMATE_MULTIPLIER = Math.max(
	1,
	Number(process.env.VALIDATION_TOKEN_ESTIMATE_MULTIPLIER || '2.2')
);
// Relations can be expensive and trigger quota/rate exhaustion on large claim graphs.
// Chunking is enabled when RELATIONS_BATCH_TARGET_TOKENS > 0 (set to 0 to disable).
const RELATIONS_BATCH_TARGET_TOKENS = (() => {
	const raw = process.env.RELATIONS_BATCH_TARGET_TOKENS;
	if (raw == null || raw.trim() === '') return 20_000;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.trunc(n);
})();
const RELATIONS_BATCH_OVERLAP_CLAIMS =
	parsePositiveInt(process.env.RELATIONS_BATCH_OVERLAP_CLAIMS) ?? 6;
const INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE =
	(process.env.INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE || 'true').toLowerCase() !== 'false';
const INGEST_SAVE_GROUPING_RAW =
	(process.env.INGEST_SAVE_GROUPING_RAW || 'false').toLowerCase() === 'true';

// ─── Stage ordering for resume logic ──────────────────────────────────────
const STAGES_ORDER = ['extracting', 'relating', 'grouping', 'embedding', 'validating', 'storing'];

function shouldRunStage(stage: string, lastCompleted: string | null | undefined): boolean {
	if (!lastCompleted) return true;
	const completedIdx = STAGES_ORDER.indexOf(lastCompleted);
	const stageIdx = STAGES_ORDER.indexOf(stage);
	if (completedIdx === -1) return true; // unknown stage = run everything
	return stageIdx > completedIdx;
}

// ─── Cost tracking ─────────────────────────────────────────────────────────
interface CostTracker {
	totalInputTokens: number;
	totalOutputTokens: number;
	vertexChars: number;
	totalUsd: number;
}

const costs: CostTracker = {
	totalInputTokens: 0,
	totalOutputTokens: 0,
	vertexChars: 0,
	totalUsd: 0
};

function estimateCost(): string {
	return (costs.totalUsd * 0.79).toFixed(4);
}

function estimateCostUsd(): string {
	return costs.totalUsd.toFixed(4);
}

function estimateUsageCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
	const estimate = estimateRestormelCost(modelId, defaultProviders);
	if (!estimate) return 0;
	return (
		((estimate.inputPerMillion ?? 0) * inputTokens + (estimate.outputPerMillion ?? 0) * outputTokens) /
		1_000_000
	);
}

function trackReasoningCost(modelId: string, inputTokens: number, outputTokens: number): number {
	const usageCostUsd = estimateUsageCostUsd(modelId, inputTokens, outputTokens);
	costs.totalInputTokens += inputTokens;
	costs.totalOutputTokens += outputTokens;
	costs.totalUsd += usageCostUsd;
	return usageCostUsd;
}

function trackEmbeddingCost(totalChars: number): number {
	const usageCostUsd = (totalChars / 1_000_000) * 0.025;
	costs.vertexChars += totalChars;
	costs.totalUsd += usageCostUsd;
	return usageCostUsd;
}

function logStageCost(label: string, tracker: StageUsageTracker, plan: IngestionStagePlan) {
	const inputDelta = currentInputTokens() - tracker.startInputTokens;
	const outputDelta = currentOutputTokens() - tracker.startOutputTokens;
	const usdDelta = Number(estimateCostUsd()) - tracker.startUsd;
	if (plan.stage === 'embedding') {
		console.log(
			`  [COST] ${label}: ${plan.provider}/${plan.model} chars=${costs.vertexChars.toLocaleString()} stage=$${usdDelta.toFixed(4)} total=$${estimateCostUsd()}`
		);
		return;
	}
	console.log(
		`  [COST] ${label}: ${plan.provider}/${plan.model} input=${inputDelta.toLocaleString()} output=${outputDelta.toLocaleString()} stage=$${usdDelta.toFixed(4)} total=$${estimateCostUsd()}`
	);
}

function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).length * 1.3);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timeoutId: NodeJS.Timeout | null = null;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeoutId) clearTimeout(timeoutId);
	});
}

function parseModelList(envValue: string | undefined, defaults: string[]): string[] {
	const fromEnv = (envValue || '')
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);

	const combined = [...fromEnv, ...defaults];
	const unique: string[] = [];
	for (const model of combined) {
		if (!unique.includes(model)) unique.push(model);
	}
	return unique;
}

function isRetryableDbError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		message.includes('econnrefused') ||
		message.includes('econnreset') ||
		message.includes('etimedout') ||
		message.includes('ehostunreach') ||
		message.includes('socket hang up') ||
		message.includes('timeout') ||
		message.includes('temporarily unavailable') ||
		message.includes('service unavailable') ||
		message.includes('503') ||
		message.includes('502') ||
		message.includes('429') ||
		message.includes('iam') ||
		message.includes('permissions') ||
		message.includes('authentication') ||
		message.includes('unauthorized')
	);
}

async function reconnectDbWithRetry(db: Surreal, reason: string): Promise<void> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= DB_CONNECT_MAX_RETRIES; attempt++) {
		try {
			try {
				await db.close();
			} catch {
				// ignore stale socket close errors
			}

			await db.connect(SURREAL_URL);
			await signinSurrealWithFallback(db);
			await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });

			if (attempt > 1) {
				console.log(`  [OK] SurrealDB reconnected after retry ${attempt}/${DB_CONNECT_MAX_RETRIES}`);
			}
			return;
		} catch (error) {
			lastError = error;
			const msg = error instanceof Error ? error.message : String(error);
			if (attempt >= DB_CONNECT_MAX_RETRIES || !isRetryableDbError(error)) {
				throw new Error(`SurrealDB reconnect failed (${reason}): ${msg}`);
			}

			const waitMs = DB_CONNECT_RETRY_BASE_MS * Math.pow(2, attempt - 1);
			console.warn(
				`  [WARN] SurrealDB reconnect attempt ${attempt}/${DB_CONNECT_MAX_RETRIES} failed (${msg}). Retrying in ${waitMs}ms...`
			);
			await sleep(waitMs);
		}
	}

	throw new Error(
		`SurrealDB reconnect failed (${reason}): ${lastError instanceof Error ? lastError.message : String(lastError)}`
	);
}

async function signinSurrealWithFallback(db: Surreal): Promise<void> {
	const access = (process.env.SURREAL_ACCESS || process.env.SURREAL_RECORD_ACCESS || '').trim();
	const attempts: Array<{ label: string; payload: Record<string, unknown> }> = [
		{
			label: 'root/basic',
			payload: { username: SURREAL_USER, password: SURREAL_PASS }
		},
		{
			label: 'namespace/basic',
			payload: {
				namespace: SURREAL_NAMESPACE,
				database: SURREAL_DATABASE,
				username: SURREAL_USER,
				password: SURREAL_PASS
			}
		},
		{
			label: 'namespace/shorthand',
			payload: {
				NS: SURREAL_NAMESPACE,
				DB: SURREAL_DATABASE,
				user: SURREAL_USER,
				pass: SURREAL_PASS
			}
		}
	];

	if (access) {
		attempts.push({
			label: `access/${access}`,
			payload: {
				namespace: SURREAL_NAMESPACE,
				database: SURREAL_DATABASE,
				access,
				username: SURREAL_USER,
				password: SURREAL_PASS
			}
		});
		attempts.push({
			label: `access-shorthand/${access}`,
			payload: {
				NS: SURREAL_NAMESPACE,
				DB: SURREAL_DATABASE,
				AC: access,
				user: SURREAL_USER,
				pass: SURREAL_PASS
			}
		});
	}

	let lastError: unknown;
	for (const attempt of attempts) {
		try {
			await db.signin(attempt.payload as any);
			if (attempt.label !== 'root/basic') {
				console.log(`  [DB] Signed in via ${attempt.label} auth mode.`);
			}
			return;
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Unknown signin error'));
}

async function dbQueryWithRetry<T>(
	db: Surreal,
	query: string,
	vars?: Record<string, unknown>,
	maxAttempts = 3
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return (await db.query(query, vars)) as T;
		} catch (error) {
			lastError = error;
			if (attempt >= maxAttempts || !isRetryableDbError(error)) {
				throw error;
			}

			const msg = error instanceof Error ? error.message : String(error);
			const waitMs = DB_CONNECT_RETRY_BASE_MS * Math.pow(2, attempt - 1);
			console.warn(
				`  [WARN] DB query failed (attempt ${attempt}/${maxAttempts}): ${msg}. Reconnecting...`
			);
			await reconnectDbWithRetry(db, `query retry attempt ${attempt}`);
			await sleep(waitMs);
		}
	}

	throw new Error(
		`DB query failed after ${maxAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
	);
}
function isModelUnavailableError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		message.includes('not_found') ||
		message.includes('model:') ||
		message.includes('not available') ||
		message.includes('unsupported model') ||
		message.includes('invalid model')
	);
}

type IngestProvider = IngestProviderPreference;
type StageKey = 'extraction' | 'relations' | 'grouping' | 'validation' | 'embedding' | 'json_repair';

interface StageBudget {
	maxInputTokens?: number;
	maxOutputTokens?: number;
	maxUsd?: number;
	maxRetries: number;
	timeoutMs: number;
}

interface StageUsageTracker {
	stage: StageKey;
	startInputTokens: number;
	startOutputTokens: number;
	startUsd: number;
	retries: number;
}

function parseIngestProvider(value: string | undefined): IngestProvider {
	if (!value) return 'auto';
	const normalized = value.toLowerCase().trim();
	if (normalized === 'auto') return 'auto';
	return normalized === 'anthropic' ? 'anthropic' : 'vertex';
}

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return Math.trunc(parsed);
}

function parsePositiveFloat(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return parsed;
}

function makeStageBudget(stage: StageKey): StageBudget {
	const upper = stage.toUpperCase();
	const timeoutFallback = stage === 'validation' ? VALIDATION_MODEL_TIMEOUT_MS : INGEST_MODEL_TIMEOUT_MS;
	return {
		maxInputTokens: parsePositiveInt(process.env[`INGEST_STAGE_${upper}_MAX_INPUT_TOKENS`]),
		maxOutputTokens: parsePositiveInt(process.env[`INGEST_STAGE_${upper}_MAX_OUTPUT_TOKENS`]),
		maxUsd: parsePositiveFloat(process.env[`INGEST_STAGE_${upper}_MAX_USD`]),
		maxRetries: parsePositiveInt(process.env[`INGEST_STAGE_${upper}_MAX_RETRIES`]) ?? 3,
		timeoutMs: parsePositiveInt(process.env[`INGEST_STAGE_${upper}_TIMEOUT_MS`]) ?? timeoutFallback
	};
}

function currentInputTokens(): number {
	return costs.totalInputTokens;
}

function currentOutputTokens(): number {
	return costs.totalOutputTokens;
}

function startStageUsage(stage: StageKey): StageUsageTracker {
	return {
		stage,
		startInputTokens: currentInputTokens(),
		startOutputTokens: currentOutputTokens(),
		startUsd: Number(estimateCostUsd()),
		retries: 0
	};
}

function assertStageBudget(stageBudget: StageBudget, tracker: StageUsageTracker): void {
	const inputDelta = currentInputTokens() - tracker.startInputTokens;
	const outputDelta = currentOutputTokens() - tracker.startOutputTokens;
	const usdDelta = Number(estimateCostUsd()) - tracker.startUsd;

	if (stageBudget.maxInputTokens !== undefined && inputDelta > stageBudget.maxInputTokens) {
		throw new Error(
			`[BUDGET] ${tracker.stage} exceeded input token cap (${inputDelta} > ${stageBudget.maxInputTokens})`
		);
	}
	if (stageBudget.maxOutputTokens !== undefined && outputDelta > stageBudget.maxOutputTokens) {
		throw new Error(
			`[BUDGET] ${tracker.stage} exceeded output token cap (${outputDelta} > ${stageBudget.maxOutputTokens})`
		);
	}
	if (stageBudget.maxUsd !== undefined && usdDelta > stageBudget.maxUsd) {
		throw new Error(`[BUDGET] ${tracker.stage} exceeded USD cap (${usdDelta.toFixed(4)} > ${stageBudget.maxUsd})`);
	}
}

function getSectionTokenLimit(sourceType: string): number {
	if (sourceType === 'book') {
		return BOOK_MAX_TOKENS_PER_SECTION;
	}
	return MAX_TOKENS_PER_SECTION;
}

function splitChunkByParagraphs(chunk: string, maxTokensPerSection: number): string[] {
	if (estimateTokens(chunk) <= maxTokensPerSection) return [chunk];

	const paragraphs = chunk
		.split(/\n\s*\n/g)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);

	if (paragraphs.length <= 1) {
		const charChunkSize = maxTokensPerSection * 4;
		const direct: string[] = [];
		for (let i = 0; i < chunk.length; i += charChunkSize) {
			const sub = chunk.substring(i, i + charChunkSize).trim();
			if (sub.length > 100) direct.push(sub);
		}
		return direct;
	}

	const grouped: string[] = [];
	let buffer = '';

	for (const paragraph of paragraphs) {
		const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
		if (estimateTokens(candidate) > maxTokensPerSection && buffer.length > 0) {
			grouped.push(buffer.trim());
			buffer = paragraph;
		} else {
			buffer = candidate;
		}
	}

	if (buffer.length > 0) {
		grouped.push(buffer.trim());
	}

	return grouped;
}

/**
 * Split large source text into sections based on headings
 */
function splitIntoSections(text: string, maxTokensPerSection = MAX_TOKENS_PER_SECTION): string[] {
	// Split on common heading patterns
	const sections: string[] = [];
	const lines = text.split('\n');
	let currentSection: string[] = [];

	for (const line of lines) {
		// Detect headings: numbered sections, ALL CAPS lines, lines followed by === or ---
		const isHeading =
			/^\d+\.\s+[A-Z]/.test(line) || // "1. Introduction"
			/^#{1,3}\s/.test(line) || // Markdown headings
			/^[A-Z][A-Z\s]{10,}$/.test(line.trim()) || // ALL CAPS
			/^(?:Chapter|Section|Part)\s+\d/i.test(line); // Chapter/Section/Part

		if (isHeading && currentSection.length > 0) {
			const sectionText = currentSection.join('\n').trim();
			if (sectionText.length > 100) {
				sections.push(sectionText);
			}
			currentSection = [line];
		} else {
			currentSection.push(line);
		}
	}

	// Push final section
	if (currentSection.length > 0) {
		const sectionText = currentSection.join('\n').trim();
		if (sectionText.length > 100) {
			sections.push(sectionText);
		}
	}

	// If we couldn't split meaningfully, return chunks by character count
	if (sections.length <= 1) {
		const chunkSize = maxTokensPerSection * 4; // ~4 chars/token
		const chunks: string[] = [];
		for (let i = 0; i < text.length; i += chunkSize) {
			chunks.push(text.substring(i, i + chunkSize));
		}
		return chunks;
	}

	// Merge small sections so each chunk is reasonably sized
	const merged: string[] = [];
	let buffer = '';
	for (const section of sections) {
		if (estimateTokens(buffer + '\n\n' + section) > maxTokensPerSection && buffer.length > 0) {
			merged.push(buffer.trim());
			buffer = section;
		} else {
			buffer = buffer ? buffer + '\n\n' + section : section;
		}
	}
	if (buffer.length > 0) {
		merged.push(buffer.trim());
	}

	// Post-process: sub-split any merged chunk that's still larger than the threshold.
	// This happens when a single heading-based section (e.g., Kant's Section II) exceeds
	// maxTokensPerSection on its own.
	const final: string[] = [];
	for (const chunk of merged) {
		if (estimateTokens(chunk) > maxTokensPerSection) {
			final.push(...splitChunkByParagraphs(chunk, maxTokensPerSection));
		} else {
			final.push(chunk);
		}
	}

	return final;
}

/**
 * Parse JSON from model response, stripping markdown code fences if present
 */
function parseJsonResponse(text: string): unknown {
	// Strip markdown code fences if present
	let cleaned = text.trim();
	if (cleaned.startsWith('```json')) {
		cleaned = cleaned.slice(7);
	} else if (cleaned.startsWith('```')) {
		cleaned = cleaned.slice(3);
	}
	if (cleaned.endsWith('```')) {
		cleaned = cleaned.slice(0, -3);
	}
	return JSON.parse(cleaned.trim());
}

function normalizeGroupingRole(value: unknown): string {
	if (typeof value !== 'string') return 'key_premise';
	const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
	if (normalized.includes('conclusion') || normalized.includes('thesis')) return 'conclusion';
	if (normalized.includes('supporting') && normalized.includes('premise')) return 'supporting_premise';
	if (normalized.includes('premise')) return 'key_premise';
	if (normalized.includes('assumption')) return 'assumption';
	if (
		normalized.includes('objection') ||
		normalized.includes('counter') ||
		normalized.includes('critique')
	)
		return 'objection';
	if (
		normalized.includes('response') ||
		normalized.includes('reply') ||
		normalized.includes('rebut') ||
		normalized.includes('defense') ||
		normalized.includes('defence')
	)
		return 'response';
	return 'key_premise';
}

function normalizePositivePosition(value: unknown): number {
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) return 1;
	return Math.max(1, Math.trunc(numberValue));
}

function normalizeGroupingPayload(payload: unknown): unknown {
	if (!Array.isArray(payload)) return payload;
	return payload.map((item) => {
		if (!item || typeof item !== 'object') return item;
		const typed = item as Record<string, unknown>;
		const claims = Array.isArray(typed.claims)
			? typed.claims.map((claim) => {
					if (!claim || typeof claim !== 'object') return claim;
					const typedClaim = claim as Record<string, unknown>;
					return {
						...typedClaim,
						position_in_source: normalizePositivePosition(typedClaim.position_in_source),
						role: normalizeGroupingRole(typedClaim.role)
					};
				})
			: typed.claims;
		return { ...typed, claims };
	});
}

type GroupingBatch = {
	claims: PhaseOneClaim[];
	relations: PhaseOneRelation[];
};

type ValidationBatch = {
	claims: PhaseOneClaim[];
	relations: PhaseOneRelation[];
	arguments: GroupingOutput;
	sourceText: string;
	estimatedPromptTokens: number;
};

function splitClaimsIntoGroupingBatches(
	claims: PhaseOneClaim[],
	targetTokens: number
): PhaseOneClaim[][] {
	if (claims.length <= 1) return [claims];
	const estimatedTotalTokens = Math.ceil(
		estimateTokens(JSON.stringify(claims, null, 2)) * GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER
	);
	if (estimatedTotalTokens <= targetTokens) return [claims];

	const batches: PhaseOneClaim[][] = [];
	let currentBatch: PhaseOneClaim[] = [];
	let currentBatchTokens = 0;

	for (const claim of claims) {
		const claimTokens = Math.ceil(
			estimateTokens(JSON.stringify(claim, null, 2)) * GROUPING_ANTHROPIC_TOKEN_ESTIMATE_MULTIPLIER
		);
		const wouldExceed = currentBatch.length > 0 && currentBatchTokens + claimTokens > targetTokens;
		if (wouldExceed) {
			batches.push(currentBatch);
			currentBatch = [claim];
			currentBatchTokens = claimTokens;
			continue;
		}

		currentBatch.push(claim);
		currentBatchTokens += claimTokens;
	}

	if (currentBatch.length > 0) {
		batches.push(currentBatch);
	}

	return batches.length > 0 ? batches : [claims];
}

function buildGroupingBatches(
	claims: PhaseOneClaim[],
	relations: PhaseOneRelation[],
	targetTokens: number
): GroupingBatch[] {
	const claimBatches = splitClaimsIntoGroupingBatches(claims, targetTokens);
	return claimBatches.map((batchClaims) => {
		const claimPositions = new Set(batchClaims.map((claim) => claim.position_in_source));
		const batchRelations = relations.filter(
			(relation) =>
				claimPositions.has(relation.from_position) && claimPositions.has(relation.to_position)
		);
		return {
			claims: batchClaims,
			relations: batchRelations
		};
	});
}

function buildRelationsBatches(
	claims: PhaseOneClaim[],
	targetTokens: number,
	overlapClaims: number
): PhaseOneClaim[][] {
	if (targetTokens <= 0 || claims.length <= 1) return [claims];

	const overlap = Math.max(0, Math.min(overlapClaims, claims.length - 1));
	const tokensPerClaim = claims.map((claim) => Math.ceil(estimateTokens(JSON.stringify(claim, null, 2))));
	const batches: PhaseOneClaim[][] = [];

	let start = 0;
	while (start < claims.length) {
		let tokens = 0;
		let end = start;

		while (end < claims.length) {
			const claimTokens = tokensPerClaim[end] ?? 0;
			const wouldExceed = end > start && tokens + claimTokens > targetTokens;
			if (wouldExceed) break;
			tokens += claimTokens;
			end += 1;
		}

		if (end === start) end = start + 1;

		batches.push(claims.slice(start, end));

		if (end >= claims.length) break;
		const nextStart = Math.max(end - overlap, start + 1);
		start = nextStart;
	}

	return batches.length > 0 ? batches : [claims];
}

function relationDedupeKey(relation: PhaseOneRelation): string {
	return `${relation.from_position}:${relation.to_position}:${relation.relation_type}`;
}

function mergeRelationsDedup(
	existing: PhaseOneRelation[],
	incoming: PhaseOneRelation[]
): PhaseOneRelation[] {
	const merged = new Map<string, PhaseOneRelation>();

	for (const r of existing) {
		merged.set(relationDedupeKey(r), { ...r, evidence_passage_ids: [...new Set(r.evidence_passage_ids)] });
	}

	for (const r of incoming) {
		const key = relationDedupeKey(r);
		const prev = merged.get(key);
		if (!prev) {
			merged.set(key, { ...r, evidence_passage_ids: [...new Set(r.evidence_passage_ids)] });
			continue;
		}

		const evidence_passage_ids = [...new Set([...(prev.evidence_passage_ids ?? []), ...(r.evidence_passage_ids ?? [])])];
		const prevHasNote = typeof prev.note === 'string' && prev.note.trim().length > 0;
		const nextHasNote = typeof r.note === 'string' && r.note.trim().length > 0;

		// Keep the higher-confidence relation, but preserve richer evidence/note when possible.
		const pickHigher = (r.relation_confidence ?? 0) > (prev.relation_confidence ?? 0) ? r : prev;
		const other = pickHigher === r ? prev : r;

		merged.set(key, {
			...pickHigher,
			evidence_passage_ids,
			note: (typeof pickHigher.note === 'string' && pickHigher.note.trim().length > 0)
				? pickHigher.note
				: nextHasNote && !prevHasNote
					? other.note
					: pickHigher.note
		});
	}

	return Array.from(merged.values()).sort((a, b) => {
		if (a.from_position !== b.from_position) return a.from_position - b.from_position;
		if (a.to_position !== b.to_position) return a.to_position - b.to_position;
		return a.relation_type.localeCompare(b.relation_type);
	});
}

function mergeGroupingOutputs(outputs: GroupingOutput[]): GroupingOutput {
	const merged = new Map<string, GroupingOutput[number]>();

	for (const output of outputs) {
		for (const argument of output) {
			const key = `${argument.name.trim().toLowerCase()}::${argument.domain}`;
			const existing = merged.get(key);
			if (!existing) {
				merged.set(key, {
					...argument,
					claims: [...argument.claims]
				});
				continue;
			}

			const claimRefs = new Map<string, GroupingOutput[number]['claims'][number]>();
			for (const claimRef of existing.claims) {
				claimRefs.set(`${claimRef.position_in_source}:${claimRef.role}`, claimRef);
			}
			for (const claimRef of argument.claims) {
				claimRefs.set(`${claimRef.position_in_source}:${claimRef.role}`, claimRef);
			}

			existing.claims = Array.from(claimRefs.values()).sort(
				(a, b) => a.position_in_source - b.position_in_source
			);
			if (!existing.tradition && argument.tradition) {
				existing.tradition = argument.tradition;
			}
			if ((!existing.summary || existing.summary.trim().length === 0) && argument.summary) {
				existing.summary = argument.summary;
			}
		}
	}

	return Array.from(merged.values());
}

function buildValidationSourceSnippet(claims: PhaseOneClaim[], sourceText: string): string {
	if (!sourceText || sourceText.length === 0) return '';
	if (claims.length === 0) {
		return sourceText.slice(0, VALIDATION_BATCH_SOURCE_MAX_CHARS);
	}

	const starts = claims
		.map((claim) => claim.source_span_start)
		.filter((value): value is number => Number.isFinite(value) && value >= 0);
	const ends = claims
		.map((claim) => claim.source_span_end)
		.filter((value): value is number => Number.isFinite(value) && value > 0);
	if (starts.length === 0 || ends.length === 0) {
		return sourceText.slice(0, VALIDATION_BATCH_SOURCE_MAX_CHARS);
	}

	const start = Math.max(0, Math.min(...starts) - VALIDATION_BATCH_SOURCE_CONTEXT_CHARS);
	const end = Math.min(sourceText.length, Math.max(...ends) + VALIDATION_BATCH_SOURCE_CONTEXT_CHARS);
	const snippet = sourceText.slice(start, end);
	if (snippet.length <= VALIDATION_BATCH_SOURCE_MAX_CHARS) return snippet;
	return snippet.slice(0, VALIDATION_BATCH_SOURCE_MAX_CHARS);
}

function buildValidationBatch(
	batchClaims: PhaseOneClaim[],
	relations: PhaseOneRelation[],
	arguments_: GroupingOutput,
	sourceText: string,
	sourceTitle: string
): ValidationBatch {
	const claimPositions = new Set(batchClaims.map((claim) => claim.position_in_source));
	const batchRelations = relations.filter(
		(relation) =>
			claimPositions.has(relation.from_position) && claimPositions.has(relation.to_position)
	);
	const batchArguments = arguments_
		.map((argument) => {
			const claims = argument.claims.filter((claimRef) =>
				claimPositions.has(claimRef.position_in_source)
			);
			if (claims.length === 0) return null;
			return {
				...argument,
				claims
			};
		})
		.filter((argument): argument is Argument => Boolean(argument));
	const batchSourceText = buildValidationSourceSnippet(batchClaims, sourceText);

	const claimsJson = JSON.stringify(batchClaims, null, 2);
	const relationsJson = JSON.stringify(batchRelations, null, 2);
	const argumentsJson = JSON.stringify(batchArguments, null, 2);
	const promptText =
		VALIDATION_SYSTEM +
		'\n\n' +
		VALIDATION_USER({
			sourceTitle,
			sourceText: batchSourceText,
			claimsJson,
			relationsJson,
			argumentsJson
		});
	const estimatedPromptTokens = Math.ceil(
		estimateTokens(promptText) * VALIDATION_TOKEN_ESTIMATE_MULTIPLIER
	);

	return {
		claims: batchClaims,
		relations: batchRelations,
		arguments: batchArguments,
		sourceText: batchSourceText,
		estimatedPromptTokens
	};
}

function buildValidationBatches(
	claims: PhaseOneClaim[],
	relations: PhaseOneRelation[],
	arguments_: GroupingOutput,
	sourceText: string,
	sourceTitle: string,
	targetTokens: number
): ValidationBatch[] {
	const seedBatches = splitClaimsIntoGroupingBatches(claims, targetTokens);
	const queue = [...seedBatches];
	const result: ValidationBatch[] = [];

	while (queue.length > 0) {
		const nextClaims = queue.shift()!;
		const batch = buildValidationBatch(nextClaims, relations, arguments_, sourceText, sourceTitle);
		if (batch.estimatedPromptTokens > targetTokens && nextClaims.length > 1) {
			const midpoint = Math.ceil(nextClaims.length / 2);
			const firstHalf = nextClaims.slice(0, midpoint);
			const secondHalf = nextClaims.slice(midpoint);
			if (secondHalf.length > 0) {
				queue.unshift(secondHalf);
			}
			if (firstHalf.length > 0) {
				queue.unshift(firstHalf);
			}
			continue;
		}
		result.push(batch);
	}

	return result.length > 0 ? result : [buildValidationBatch(claims, relations, arguments_, sourceText, sourceTitle)];
}

function mergeValidationIssueText(existing?: string, incoming?: string): string | undefined {
	const parts = new Set<string>();
	for (const value of [existing, incoming]) {
		if (!value) continue;
		for (const token of value.split('|').map((token) => token.trim())) {
			if (token) parts.add(token);
		}
	}
	if (parts.size === 0) return undefined;
	return [...parts].join(' | ');
}

function mergeValidationOutputs(outputs: ValidationOutput[]): ValidationOutput {
	const claimMap = new Map<number, NonNullable<ValidationOutput['claims']>[number]>();
	const relationMap = new Map<string, NonNullable<ValidationOutput['relations']>[number]>();
	const argumentMap = new Map<string, NonNullable<ValidationOutput['arguments']>[number]>();
	const quarantineItems = new Set<string>();
	const summaries: string[] = [];

	for (const [index, output] of outputs.entries()) {
		if (output.summary?.trim()) {
			summaries.push(`Batch ${index + 1}: ${output.summary.trim()}`);
		}
		for (const item of output.quarantine_items ?? []) {
			if (item) quarantineItems.add(item);
		}

		for (const claim of output.claims ?? []) {
			const existing = claimMap.get(claim.position_in_source);
			if (!existing) {
				claimMap.set(claim.position_in_source, { ...claim });
			} else {
				existing.faithfulness_score = Math.min(existing.faithfulness_score, claim.faithfulness_score);
				existing.quarantine = Boolean(existing.quarantine || claim.quarantine);
				existing.faithfulness_issue = mergeValidationIssueText(
					existing.faithfulness_issue,
					claim.faithfulness_issue
				);
				existing.atomicity_issue = mergeValidationIssueText(
					existing.atomicity_issue,
					claim.atomicity_issue
				);
				existing.classification_issue = mergeValidationIssueText(
					existing.classification_issue,
					claim.classification_issue
				);
				existing.domain_issue = mergeValidationIssueText(existing.domain_issue, claim.domain_issue);
			}
			if (claim.quarantine) quarantineItems.add(`claim:${claim.position_in_source}`);
		}

		for (const relation of output.relations ?? []) {
			const key = `${relation.from_position}->${relation.to_position}`;
			const existing = relationMap.get(key);
			if (!existing) {
				relationMap.set(key, { ...relation });
			} else {
				existing.validity_score = Math.min(existing.validity_score, relation.validity_score);
				existing.quarantine = Boolean(existing.quarantine || relation.quarantine);
				existing.validity_issue = mergeValidationIssueText(
					existing.validity_issue,
					relation.validity_issue
				);
				existing.type_issue = mergeValidationIssueText(existing.type_issue, relation.type_issue);
			}
			if (relation.quarantine) quarantineItems.add(`relation:${key}`);
		}

		for (const argumentIssue of output.arguments ?? []) {
			const key = argumentIssue.argument_name.trim().toLowerCase();
			const existing = argumentMap.get(key);
			if (!existing) {
				argumentMap.set(key, { ...argumentIssue });
			} else {
				existing.coherence_score = Math.min(existing.coherence_score, argumentIssue.coherence_score);
				existing.quarantine = Boolean(existing.quarantine || argumentIssue.quarantine);
				existing.coherence_issue = mergeValidationIssueText(
					existing.coherence_issue,
					argumentIssue.coherence_issue
				);
				existing.role_issues = mergeValidationIssueText(existing.role_issues, argumentIssue.role_issues);
			}
			if (argumentIssue.quarantine) quarantineItems.add(`argument:${argumentIssue.argument_name}`);
		}
	}

	const merged: ValidationOutput = {
		claims: [...claimMap.values()].sort((a, b) => a.position_in_source - b.position_in_source),
		relations: [...relationMap.values()].sort((a, b) =>
			a.from_position === b.from_position
				? a.to_position - b.to_position
				: a.from_position - b.from_position
		),
		arguments: [...argumentMap.values()].sort((a, b) => a.argument_name.localeCompare(b.argument_name)),
		quarantine_items: [...quarantineItems].sort(),
		summary: summaries.join(' ').trim() || 'Validation completed across batched prompts.'
	};

	return normalizeValidationOutput(merged);
}

function analyzeGroupingReferenceHealth(arguments_: GroupingOutput): {
	totalReferences: number;
	uniquePositions: number;
	positionOneReferences: number;
	positionOneShare: number;
	collapsed: boolean;
} {
	const positions: number[] = [];
	for (const argument of arguments_) {
		for (const claimRef of argument.claims) {
			positions.push(claimRef.position_in_source);
		}
	}
	const totalReferences = positions.length;
	const uniquePositions = new Set(positions).size;
	const positionOneReferences = positions.filter((position) => position === 1).length;
	const positionOneShare = totalReferences > 0 ? positionOneReferences / totalReferences : 0;
	const collapsed =
		totalReferences >= 20 &&
		(uniquePositions <= 3 || (positionOneShare >= 0.8 && positionOneReferences >= 20));
	return {
		totalReferences,
		uniquePositions,
		positionOneReferences,
		positionOneShare,
		collapsed
	};
}

function normalizeExtractionDomain(value: unknown): string {
	if (typeof value !== 'string') return 'philosophy_of_mind';
	const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
	const domainMap: Record<string, string> = {
		ethics: 'ethics',
		epistemology: 'epistemology',
		metaphysics: 'metaphysics',
		philosophy_of_mind: 'philosophy_of_mind',
		mind: 'philosophy_of_mind',
		political_philosophy: 'political_philosophy',
		logic: 'logic',
		aesthetics: 'aesthetics',
		philosophy_of_science: 'philosophy_of_science',
		philosophy_of_language: 'philosophy_of_language',
		applied_ethics: 'applied_ethics',
		philosophy_of_ai: 'philosophy_of_ai'
	};
	return domainMap[normalized] ?? 'philosophy_of_mind';
}

function normalizeExtractionClaimType(value: unknown): string {
	if (typeof value !== 'string') return 'premise';
	const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
	const typeMap: Record<string, string> = {
		thesis: 'thesis',
		premise: 'premise',
		objection: 'objection',
		counterargument: 'objection',
		counter_argument: 'objection',
		response: 'response',
		reply: 'response',
		rebuttal: 'response',
		definition: 'definition',
		thought_experiment: 'thought_experiment',
		thoughtexperiment: 'thought_experiment',
		empirical: 'empirical',
		methodological: 'methodological'
	};
	return typeMap[normalized] ?? 'premise';
}

function normalizeExtractionPayload(payload: unknown, forcedDomain?: string): unknown {
	if (!Array.isArray(payload)) return payload;
	const domainOverride = forcedDomain ? normalizeExtractionDomain(forcedDomain) : null;
	return payload.map((item, index) => {
		if (!item || typeof item !== 'object') return item;
		const typed = item as Record<string, unknown>;
		const confidenceRaw = Number(typed.confidence ?? 0.8);
		const confidence = Number.isFinite(confidenceRaw)
			? Math.max(0, Math.min(1, confidenceRaw))
			: 0.8;
		return {
			...typed,
			claim_type: normalizeExtractionClaimType(typed.claim_type),
			domain: domainOverride ?? normalizeExtractionDomain(typed.domain),
			position_in_source: normalizePositivePosition(typed.position_in_source ?? index + 1),
			confidence
		};
		});
}

function reviewStateForConfidence(confidence: number): ReviewState {
	return confidence < LOW_CONFIDENCE_REVIEW_THRESHOLD ? 'needs_review' : 'candidate';
}

function relationConfidenceFromStrength(strength?: string): number {
	if (strength === 'strong') return 0.9;
	if (strength === 'weak') return 0.58;
	return 0.74;
}

function findFallbackPassage(
	claim: Pick<ExtractionClaim, 'section_context' | 'position_in_source'>,
	passages: PassageRecord[]
): PassageRecord {
	const bySection = passages.find(
		(passage) =>
			passage.section_title &&
			claim.section_context &&
			passage.section_title.toLowerCase() === claim.section_context.toLowerCase()
	);
	if (bySection) return bySection;
	const index = Math.min(
		passages.length - 1,
		Math.max(0, (claim.position_in_source ?? 1) - 1)
	);
	return passages[index] ?? passages[0]!;
}

function attachPassageMetadataToClaims(
	claims: ExtractionOutput,
	passages: PassageRecord[],
	positionOffset = 0,
	sourceMeta?: Pick<SourceMeta, 'title' | 'author' | 'year'>
): PhaseOneClaim[] {
	const passageById = new Map(passages.map((passage) => [passage.id, passage]));
	return claims.map((claim, index) => {
		const matchedPassage =
			(typeof claim.passage_id === 'string' ? passageById.get(claim.passage_id) : undefined) ??
			(passages.length === 1 ? passages[0] : undefined) ??
			findFallbackPassage(claim, passages);
		// Do not trust model-supplied positions; make ordering deterministic per batch.
		const position = positionOffset + index + 1;
		const typingMetadata = deriveClaimTypingMetadata(
			{
				text: claim.text,
				claim_type: claim.claim_type,
				claim_origin: claim.claim_origin,
				subdomain: claim.subdomain,
				thinker: claim.thinker,
				tradition: claim.tradition,
				era: claim.era,
				claim_scope: claim.claim_scope,
				concept_tags: claim.concept_tags,
				domain: claim.domain
			},
			{
				sourceTitle: sourceMeta?.title ?? '',
				sourceAuthors: sourceMeta?.author ?? [],
				sourceYear: sourceMeta?.year,
				passageRole: matchedPassage?.role
			}
		);
		return {
			...claim,
			position_in_source: position,
			passage_id: matchedPassage?.id,
			passage_order: matchedPassage?.order_in_source,
			passage_role: matchedPassage?.role,
			section_context: claim.section_context ?? matchedPassage?.section_title ?? undefined,
			source_span_start: matchedPassage?.span.start,
			source_span_end: matchedPassage?.span.end,
			claim_origin: typingMetadata.claim_origin,
			subdomain: typingMetadata.subdomain,
			thinker: typingMetadata.thinker,
			tradition: typingMetadata.tradition,
			era: typingMetadata.era,
			claim_scope: typingMetadata.claim_scope,
			attributed_to: typingMetadata.attributed_to,
			concept_tags: typingMetadata.concept_tags,
			verification_state: 'unverified' as const,
			review_state: reviewStateForConfidence(claim.confidence),
			extractor_version: INGEST_EXTRACTOR_VERSION,
			contested_terms: typingMetadata.contested_terms
		};
	});
}

function normalizeSequentialClaimPositions(claims: PhaseOneClaim[]): PhaseOneClaim[] {
	return claims.map((claim, index) => {
		const expected = index + 1;
		if (claim.position_in_source === expected) return claim;
		return { ...claim, position_in_source: expected };
	});
}

function ensurePhaseOneClaims(
	claims: PhaseOneClaim[] | ExtractionOutput,
	passages: PassageRecord[],
	sourceMeta?: Pick<SourceMeta, 'title' | 'author' | 'year'>
): PhaseOneClaim[] {
	return claims.map((claim) => {
		if ('claim_origin' in claim && typeof claim.claim_origin === 'string') {
			return claim as PhaseOneClaim;
		}
		const fallbackPassage = findFallbackPassage(claim, passages);
		const typingMetadata = deriveClaimTypingMetadata(
			{
				text: (claim as ExtractionClaim).text,
				claim_type: (claim as ExtractionClaim).claim_type,
				claim_origin: (claim as ExtractionClaim).claim_origin,
				subdomain: (claim as ExtractionClaim).subdomain,
				thinker: (claim as ExtractionClaim).thinker,
				tradition: (claim as ExtractionClaim).tradition,
				era: (claim as ExtractionClaim).era,
				claim_scope: (claim as ExtractionClaim).claim_scope,
				concept_tags: (claim as ExtractionClaim).concept_tags,
				domain: (claim as ExtractionClaim).domain
			},
			{
				sourceTitle: sourceMeta?.title ?? '',
				sourceAuthors: sourceMeta?.author ?? [],
				sourceYear: sourceMeta?.year,
				passageRole: fallbackPassage.role
			}
		);
		return {
			...(claim as ExtractionClaim),
			passage_id: fallbackPassage.id,
			passage_order: fallbackPassage.order_in_source,
			passage_role: fallbackPassage.role,
			source_span_start: fallbackPassage.span.start,
			source_span_end: fallbackPassage.span.end,
			claim_origin: typingMetadata.claim_origin,
			subdomain: typingMetadata.subdomain,
			thinker: typingMetadata.thinker,
			tradition: typingMetadata.tradition,
			era: typingMetadata.era,
			claim_scope: typingMetadata.claim_scope,
			attributed_to: typingMetadata.attributed_to,
			concept_tags: typingMetadata.concept_tags,
			verification_state: 'unverified' as const,
			review_state: reviewStateForConfidence((claim as ExtractionClaim).confidence ?? 0.8),
			extractor_version: INGEST_EXTRACTOR_VERSION,
			contested_terms: typingMetadata.contested_terms
		};
	});
}

function attachRelationMetadata(relations: RelationsOutput, claims: PhaseOneClaim[]): PhaseOneRelation[] {
	const claimByPosition = new Map(claims.map((claim) => [claim.position_in_source, claim]));
	return relations.map((relation) => {
		const fromClaim = claimByPosition.get(relation.from_position);
		const toClaim = claimByPosition.get(relation.to_position);
		const evidencePassageIds = Array.from(
			new Set([fromClaim?.passage_id, toClaim?.passage_id].filter((value): value is string => Boolean(value)))
		);
		const explicit =
			(fromClaim?.passage_id && fromClaim.passage_id === toClaim?.passage_id) ||
			(relation.relation_type === 'responds_to' &&
				fromClaim?.claim_type === 'response' &&
				toClaim?.claim_type === 'objection');
		const relationConfidence = relationConfidenceFromStrength(relation.strength);
		return {
			...relation,
			evidence_passage_ids: evidencePassageIds,
			relation_confidence: relationConfidence,
			relation_inference_mode: (explicit ? 'explicit' : 'inferred') as 'explicit' | 'inferred',
			verification_state: 'unverified' as const,
			review_state: reviewStateForConfidence(relationConfidence),
			extractor_version: INGEST_EXTRACTOR_VERSION
		};
	});
}

function assertValidSourceMetadata(sourceMeta: SourceMeta): void {
	if (!sourceMeta.title?.trim() || sourceMeta.title.trim().toLowerCase() === 'unknown') {
		throw new Error('[INTEGRITY] Source metadata missing usable title');
	}
	if (!sourceMeta.url?.trim()) {
		throw new Error('[INTEGRITY] Source metadata missing URL');
	}
	const identity = canonicalizeAndHashSourceUrl(sourceMeta.canonical_url || sourceMeta.url);
	if (!identity) {
		throw new Error('[INTEGRITY] Source metadata URL cannot be canonicalized');
	}
	sourceMeta.canonical_url = identity.canonicalUrl;
	sourceMeta.canonical_url_hash = identity.canonicalUrlHash;
	sourceMeta.visibility_scope = sourceMeta.visibility_scope || 'public_shared';
	sourceMeta.deletion_state = sourceMeta.deletion_state || 'active';
}

function assertFiniteCostEstimate(): void {
	const estimatedUsd = Number(estimateCostUsd());
	if (!Number.isFinite(estimatedUsd)) {
		throw new Error('[INTEGRITY] Cost estimate is non-finite');
	}
}

function assertClaimIntegrity(claims: PhaseOneClaim[]): void {
	if (claims.length === 0) {
		throw new Error('[INTEGRITY] Stage 1 produced 0 claims');
	}

	const seenPositions = new Set<number>();
	let previousPosition = 0;
	for (const claim of [...claims].sort((a, b) => a.position_in_source - b.position_in_source)) {
		if (seenPositions.has(claim.position_in_source)) {
			throw new Error(`[INTEGRITY] Duplicate claim position detected: ${claim.position_in_source}`);
		}
		if (claim.position_in_source <= previousPosition) {
			throw new Error(
				`[INTEGRITY] Non-monotonic claim positions detected around ${claim.position_in_source}`
			);
		}
		if (
			typeof claim.source_span_start !== 'number' ||
			typeof claim.source_span_end !== 'number' ||
			claim.source_span_end < claim.source_span_start
		) {
			throw new Error(
				`[INTEGRITY] Claim ${claim.position_in_source} missing valid source span provenance`
			);
		}
		if (!claim.claim_origin || !claim.claim_scope) {
			throw new Error(
				`[INTEGRITY] Claim ${claim.position_in_source} missing Stage 1.2 typing metadata`
			);
		}
		seenPositions.add(claim.position_in_source);
		previousPosition = claim.position_in_source;
	}
}

function assertRelationIntegrity(relations: PhaseOneRelation[], claims: PhaseOneClaim[]): void {
	const knownPositions = new Set(claims.map((claim) => claim.position_in_source));
	const missingEndpoints = relations.filter(
		(relation) =>
			!knownPositions.has(relation.from_position) || !knownPositions.has(relation.to_position)
	);
	if (missingEndpoints.length > 0) {
		const sample = missingEndpoints
			.slice(0, 5)
			.map((relation) => `${relation.from_position}->${relation.to_position}`)
			.join(', ');
		throw new Error(
			`[INTEGRITY] ${missingEndpoints.length} relations reference missing claim positions (${sample})`
		);
	}
}

async function callStageModel(params: {
	stage: StageKey;
	plan: IngestionStagePlan;
	budget: StageBudget;
	tracker: StageUsageTracker;
	systemPrompt: string;
	userMessage: string;
	maxTokens?: number;
}): Promise<string> {
	const { stage, plan, budget, tracker, systemPrompt, userMessage, maxTokens = 32768 } = params;
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= budget.maxRetries; attempt++) {
		try {
			if (attempt > 0) {
				if (tracker.retries >= budget.maxRetries) {
					throw new Error(`[BUDGET] ${stage} exceeded retry cap (${budget.maxRetries})`);
				}
				tracker.retries += 1;
				const delayMs = 1000 * Math.pow(2, attempt - 1);
				console.log(
					`  [RETRY] ${stage} ${plan.provider}:${plan.model} attempt ${attempt + 1}/${budget.maxRetries + 1} (${delayMs}ms backoff)`
				);
				await sleep(delayMs);
			}

			if (!plan.route) {
				throw new Error(`No executable route available for ${stage}`);
			}

			const result = await withTimeout(
				generateText({
					model: plan.route.model,
					system: systemPrompt,
					messages: [{ role: 'user', content: userMessage }],
					temperature: 0.1,
					maxOutputTokens: maxTokens
				}),
				budget.timeoutMs,
				`${stage} ${plan.provider}:${plan.model}`
			);
			const inputTokens = result.usage?.inputTokens ?? 0;
			const outputTokens = result.usage?.outputTokens ?? 0;
			const usageCostUsd = trackReasoningCost(plan.model, inputTokens, outputTokens);
			if (result.finishReason === 'length') {
				throw new Error('Model output was truncated (max_tokens reached)');
			}
			console.log(
				`  [ROUTE] ${stage}: ${plan.provider}/${plan.model} source=${plan.routingSource} step=${plan.selectedStepId ?? '—'} order=${plan.selectedOrderIndex ?? '—'} switch=${plan.switchReasonCode ?? '—'} cost~$${usageCostUsd.toFixed(4)}`
			);
			assertStageBudget(budget, tracker);
			return result.text;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			const msg = lastError.message;
			const retryable =
				msg.includes('429') ||
				msg.includes('529') ||
				msg.includes('500') ||
				msg.includes('overloaded') ||
				msg.includes('timeout') ||
				msg.includes('prompt_too_long') ||
				msg.includes('context_length') ||
				/resource exhausted/i.test(msg) ||
				/rate limit|quota|too many requests/i.test(msg);
			console.warn(`  [WARN] ${stage} ${plan.provider}:${plan.model} failed: ${lastError.message}`);
			if (isModelUnavailableError(lastError)) break;
			if (!retryable) break;
		}
	}

	throw new Error(
		`[${stage}] Planned route exhausted (${plan.provider}:${plan.model}): ${lastError?.message || 'Unknown error'}`
	);
}

async function callStageModelWithProgress(params: {
	stage: StageKey;
	plan: IngestionStagePlan;
	budget: StageBudget;
	tracker: StageUsageTracker;
	systemPrompt: string;
	userMessage: string;
	label: string;
	maxTokens?: number;
}): Promise<string> {
	const spinner = startSpinner(params.label);
	try {
		const result = await callStageModel(params);
		spinner.stop();
		return result;
	} catch (error) {
		spinner.stop();
		throw error;
	}
}

async function fixJsonWithModel(
	repairPlan: IngestionStagePlan,
	repairBudget: StageBudget,
	repairTracker: StageUsageTracker,
	originalJson: string,
	parseError: string,
	schema: string
): Promise<string> {
	console.log(`  [FIX] Repair route: ${repairPlan.provider}:${repairPlan.model}`);

	const fixPrompt = `The following JSON output was malformed. Please fix it so it is valid JSON matching this schema:

Schema: ${schema}

Error: ${parseError}

Malformed JSON:
${originalJson}

Respond ONLY with the corrected JSON array. No explanation, no markdown backticks.`;

	return callStageModelWithProgress({
		stage: 'json_repair',
		plan: repairPlan,
		budget: repairBudget,
		tracker: repairTracker,
		systemPrompt:
			'You are a JSON repair assistant. Fix the malformed JSON to be valid. Respond with only the corrected JSON.',
		userMessage: fixPrompt,
		label: 'Fixing malformed JSON'
	});
}

// ─── Source Metadata ───────────────────────────────────────────────────────
interface SourceMeta {
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

type PhaseOneClaim = ExtractionClaim & PhaseOneClaimMetadata;
type PhaseOneRelation = Relation & PhaseOneRelationMetadata;

// ─── Partial Results (for crash recovery) ──────────────────────────────────
interface PartialResults {
	source: SourceMeta;
	claims?: PhaseOneClaim[];
	relations?: PhaseOneRelation[];
	arguments?: GroupingOutput;
	embeddings?: number[][];
	validation?: ValidationOutput | null;
	stage_completed: string;
	/** Cumulative estimated USD at last save; used to seed cost tracker when resuming after failure. */
	cost_usd_snapshot?: number;
	// Mid-extraction checkpoint: if extraction crashes mid-batch, resume from here
	extraction_progress?: {
		claims_so_far: PhaseOneClaim[];
		remaining_batches?: PassageRecord[][];
		remaining_sections?: string[];
	};
	// Mid-grouping checkpoint: resume from next unfinished grouping batch
	grouping_progress?: {
		grouped_outputs_so_far: GroupingOutput[];
		next_batch_index: number;
		total_batches: number;
	};
	// Mid-validation checkpoint: resume from next unfinished validation batch
	validation_progress?: {
		batch_outputs_so_far: ValidationOutput[];
		next_batch_index: number;
		total_batches: number;
		should_validate: boolean;
	};
	// Mid-relations checkpoint: resume from next unfinished relations batch
	relations_progress?: {
		relations_so_far: PhaseOneRelation[];
		next_batch_index: number;
		total_batches: number;
	};
}

function savePartialResults(slug: string, results: PartialResults) {
	if (!fs.existsSync(INGESTED_DIR)) {
		fs.mkdirSync(INGESTED_DIR, { recursive: true });
	}
	const partialPath = path.join(INGESTED_DIR, `${slug}-partial.json`);
	const tmpPath = `${partialPath}.tmp`;
	const snapshot = parseFloat(estimateCostUsd());
	const withSnapshot: PartialResults = {
		...results,
		cost_usd_snapshot: Number.isFinite(snapshot) && snapshot >= 0 ? snapshot : results.cost_usd_snapshot
	};
	// Write to temp file first, then atomic rename — prevents corruption on crash mid-write
	fs.writeFileSync(tmpPath, JSON.stringify(withSnapshot, null, 2), 'utf-8');
	fs.renameSync(tmpPath, partialPath);
	console.log(`  [SAVE] Partial results saved to: ${partialPath}`);
}

function saveGroupingDebugRaw(slug: string, batchIndex: number, rawResponse: string): void {
	if (!INGEST_SAVE_GROUPING_RAW) return;
	if (!fs.existsSync(INGESTED_DIR)) {
		fs.mkdirSync(INGESTED_DIR, { recursive: true });
	}
	const safeSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '_');
	const filePath = path.join(INGESTED_DIR, `${safeSlug}-grouping-batch-${batchIndex + 1}.raw.txt`);
	fs.writeFileSync(filePath, rawResponse, 'utf-8');
	console.log(`  [DEBUG] Saved grouping raw batch ${batchIndex + 1} to ${filePath}`);
}

function loadPartialResults(slug: string): PartialResults | null {
	const partialPath = path.join(INGESTED_DIR, `${slug}-partial.json`);
	if (!fs.existsSync(partialPath)) {
		return null;
	}
	try {
		const data = fs.readFileSync(partialPath, 'utf-8');
		return JSON.parse(data) as PartialResults;
	} catch (error) {
		console.warn(`  [WARN] Failed to load partial results: ${error}`);
		return null;
	}
}

// ─── Ingestion Log (DB-based tracking) ────────────────────────────────────
interface IngestionLogRecord {
	id?: string;
	source_url: string;
	canonical_url?: string;
	canonical_url_hash?: string;
	source_title: string;
	status: string;
	stage_completed?: string;
	claims_extracted?: number;
	relations_extracted?: number;
	arguments_grouped?: number;
	validation_score?: number;
	error_message?: string;
	cost_usd?: number;
	started_at?: string;
	completed_at?: string;
}

function buildSourceUrlCandidates(sourceUrl: string): string[] {
	const identity = canonicalizeAndHashSourceUrl(sourceUrl);
	if (!identity) return [sourceUrl];

	const candidates = new Set<string>([identity.canonicalUrl]);
	try {
		const parsed = new URL(identity.canonicalUrl);
		if (parsed.pathname.length > 1 && !parsed.pathname.endsWith('/')) {
			const withSlash = new URL(identity.canonicalUrl);
			withSlash.pathname = `${withSlash.pathname}/`;
			candidates.add(withSlash.toString());
		} else if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
			const withoutSlash = new URL(identity.canonicalUrl);
			withoutSlash.pathname = withoutSlash.pathname.replace(/\/+$/, '');
			candidates.add(withoutSlash.toString());
		}
	} catch {
		// ignore malformed fallback variants
	}

	return [...candidates];
}

async function getIngestionLog(db: Surreal, sourceUrl: string): Promise<IngestionLogRecord | null> {
	const identity = canonicalizeAndHashSourceUrl(sourceUrl);
	const result = await db.query<IngestionLogRecord[][]>(
		`SELECT * FROM ingestion_log
		 WHERE source_url INSIDE $source_urls
		    OR canonical_url_hash = $canonical_url_hash
		 LIMIT 1`,
		{
			source_urls: buildSourceUrlCandidates(sourceUrl),
			canonical_url_hash: identity?.canonicalUrlHash ?? sourceUrl
		}
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	return rows.length > 0 ? rows[0] : null;
}

async function createIngestionLog(db: Surreal, sourceUrl: string, sourceTitle: string): Promise<void> {
	const identity = canonicalizeAndHashSourceUrl(sourceUrl);
	if (!identity) {
		throw new Error(`[INTEGRITY] Cannot create ingestion log for invalid source URL: ${sourceUrl}`);
	}
	await db.query(
		`CREATE ingestion_log CONTENT {
			source_url: $url,
			canonical_url: $canonical_url,
			canonical_url_hash: $canonical_url_hash,
			source_title: $title,
			status: 'extracting',
			started_at: time::now()
		}`,
		{
			url: identity.canonicalUrl,
			canonical_url: identity.canonicalUrl,
			canonical_url_hash: identity.canonicalUrlHash,
			title: sourceTitle
		}
	);
}

async function updateIngestionLog(
	db: Surreal,
	sourceUrl: string,
	updates: Record<string, unknown>
): Promise<void> {
	if (Object.keys(updates).length === 0) return;

	const identity = canonicalizeAndHashSourceUrl(sourceUrl);
	if (!identity) {
		throw new Error(`[INTEGRITY] Cannot update ingestion log for invalid source URL: ${sourceUrl}`);
	}
	const setClauses = Object.keys(updates)
		.map((key) => `${key} = $${key}`)
		.join(', ');
	const sql = `UPDATE ingestion_log
		SET source_url = $canonical_url,
			canonical_url = $canonical_url,
			canonical_url_hash = $canonical_url_hash,
			${setClauses}
		WHERE source_url INSIDE $source_urls OR canonical_url_hash = $canonical_url_hash`;
	const vars = {
		...updates,
		canonical_url: identity.canonicalUrl,
		source_urls: buildSourceUrlCandidates(sourceUrl),
		canonical_url_hash: identity.canonicalUrlHash
	};
	await dbQueryWithRetry(db, sql, vars, 3);
}

/**
 * Verify DB connection is alive; re-authenticate if the session has expired.
 * Call this before any stage that performs DB writes after a long gap.
 */
async function ensureDbConnected(db: Surreal): Promise<void> {
	try {
		await db.query('INFO FOR DB;');
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (isRetryableDbError(error)) {
			console.warn(`  [WARN] DB health check failed (${msg}) — reconnecting...`);
			await reconnectDbWithRetry(db, 'health check');
			await dbQueryWithRetry(db, 'INFO FOR DB;', undefined, 2);
			console.log('  [OK] SurrealDB connection restored');
		} else {
			throw new Error(`DB connection check failed: ${msg}`);
		}
	}
}

function normalizeResumeStage(
	lastCompleted: string | null,
	partial: PartialResults
): string | null {
	if (!lastCompleted) return null;

	const hasClaims = Array.isArray(partial.claims) && partial.claims.length > 0;
	const hasRelations = Array.isArray(partial.relations);
	const hasArguments = Array.isArray(partial.arguments);
	const hasEmbeddings = Array.isArray(partial.embeddings);

	if (!hasClaims) return null;
	if (!hasRelations && ['relating', 'grouping', 'embedding', 'validating', 'storing'].includes(lastCompleted)) {
		return 'extracting';
	}
	if (!hasArguments && ['grouping', 'embedding', 'validating', 'storing'].includes(lastCompleted)) {
		return 'relating';
	}
	if (!hasEmbeddings && ['embedding', 'validating', 'storing'].includes(lastCompleted)) {
		return 'grouping';
	}

	return lastCompleted;
}

// ─── MAIN PIPELINE ─────────────────────────────────────────────────────────
async function main() {
	const args = process.argv.slice(2);
	const filePath = args.find((a) => !a.startsWith('--'));
	const shouldValidate = args.includes('--validate');
	const ingestProviderFlagIdx = args.findIndex((a) => a === '--ingest-provider');
	const ingestProviderFlag = ingestProviderFlagIdx !== -1 ? args[ingestProviderFlagIdx + 1] : undefined;
	const ingestProvider = parseIngestProvider(ingestProviderFlag ?? INGEST_PROVIDER_DEFAULT);
	const extractionBudget = makeStageBudget('extraction');
	const relationBudget = makeStageBudget('relations');
	const groupingBudget = makeStageBudget('grouping');
	const validationBudget = makeStageBudget('validation');
	const embeddingBudget = makeStageBudget('embedding');
	const jsonRepairBudget = makeStageBudget('json_repair');
	// Pipeline mode: exit after stages 1-4 so the batch can start the next source's
	// Claude extraction while Gemini validation runs for this source in a separate process.
	const stopAfterEmbedding = args.includes('--stop-after-embedding');
	// Admin UI: exit after Stage 5 so the operator explicitly resumes for Stage 6 (SurrealDB store).
	const stopBeforeStore = args.includes('--stop-before-store');
	// Domain override: when set, all claims from this source are tagged with this domain,
	// overriding whatever domain Claude assigns during extraction.
	const domainOverrideIdx = args.findIndex((a) => a === '--domain');
	const domainOverride = domainOverrideIdx !== -1 ? args[domainOverrideIdx + 1] : null;

	// Force-stage: re-run from a specific stage, ignoring saved progress.
	// e.g. --force-stage embedding re-runs Stage 4 onwards.
	const forceStageIdx = args.findIndex((a) => a === '--force-stage');
	const forceStage = forceStageIdx !== -1 ? args[forceStageIdx + 1] : null;
	if (forceStage && !STAGES_ORDER.includes(forceStage)) {
		console.error(`[ERROR] Unknown --force-stage value: ${forceStage}`);
		console.error(`Valid stages: ${STAGES_ORDER.join(', ')}`);
		process.exit(1);
	}

	if (!filePath) {
		console.error('Usage: npx tsx --env-file=.env scripts/ingest.ts <source-file-path> [--validate] [--domain <domain>]');
		console.error('\nThe source-file-path should be a .txt file in data/sources/');
		console.error('\nFlags:');
		console.error('  --validate              Optional spot-check: run Gemini cross-model validation');
		console.error('  --domain <domain>       Override claim domain tag (e.g. philosophy_of_mind)');
		console.error('  --ingest-provider <p>   Provider hint: auto | vertex | anthropic (default: auto)');
		console.error('  --force-stage <stage>   Re-run from this stage onwards, ignoring saved progress');
		console.error(`                          Valid stages: ${STAGES_ORDER.join(', ')}`);
		console.error('  --stop-before-store     Exit after validation; re-run the same source to execute Stage 6 (store)');
		console.error('\nRestormel route env vars (optional):');
		console.error('  RESTORMEL_INGEST_ROUTE_ID, RESTORMEL_INGEST_VALIDATION_ROUTE_ID');
		console.error('  RESTORMEL_INGEST_EXTRACTION_ROUTE_ID, RESTORMEL_INGEST_RELATIONS_ROUTE_ID, RESTORMEL_INGEST_GROUPING_ROUTE_ID, RESTORMEL_INGEST_JSON_REPAIR_ROUTE_ID');
		console.error('\nResume is automatic — re-run the same source to pick up where it left off.');
		process.exit(1);
	}

	// Validate environment
	if (!GOOGLE_VERTEX_PROJECT) {
		console.error('[ERROR] GOOGLE_VERTEX_PROJECT (or GCP_PROJECT_ID) is required');
		process.exit(1);
	}
	if (shouldValidate && !GOOGLE_VERTEX_PROJECT) {
		console.error('[ERROR] --validate flag requires GOOGLE_VERTEX_PROJECT (or GCP_PROJECT_ID) — uses Vertex AI ADC');
		process.exit(1);
	}

	// Load source files
	const txtPath = path.resolve(filePath);
	const metaPath = txtPath.replace(/\.txt$/, '.meta.json');

	if (!fs.existsSync(txtPath)) {
		console.error(`[ERROR] Source text not found: ${txtPath}`);
		process.exit(1);
	}
	if (!fs.existsSync(metaPath)) {
		console.error(`[ERROR] Source metadata not found: ${metaPath}`);
		process.exit(1);
	}

	const sourceText = fs.readFileSync(txtPath, 'utf-8');
	const sourceMeta: SourceMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
	const slug = path.basename(txtPath, '.txt');
	assertValidSourceMetadata(sourceMeta);
	const sectionTokenLimit = getSectionTokenLimit(sourceMeta.source_type);
	const passages = segmentArgumentativePassages(sourceText, {
		maxTokensPerPassage: Math.min(sectionTokenLimit, 900)
	});
	const extractionBatches = buildPassageBatches(passages, sectionTokenLimit);

	// ─── Connect to SurrealDB (used for ingestion log + Stage 6 storage) ───
	const db = new Surreal();
	try {
		await reconnectDbWithRetry(db, 'initial startup');
	} catch (error) {
		console.error(`[ERROR] Failed to connect to SurrealDB: ${error instanceof Error ? error.message : String(error)}`);
		console.error('The ingestion pipeline requires SurrealDB for progress tracking.');
		process.exit(1);
	}

	// ─── Check ingestion log for resume status ─────────────────────────────
	let resumeFromStage: string | null = null;
	const existingLog = await getIngestionLog(db, sourceMeta.url);

	if (existingLog) {
		if (existingLog.status === 'complete' && !forceStage) {
			console.log(`[SKIP] "${sourceMeta.title}" already ingested (status: complete)`);
			await db.close();
			process.exit(0);
		}

		// Failed or partial — attempt resume
		resumeFromStage = existingLog.stage_completed || null;
		console.log('╔══════════════════════════════════════════════════════════════╗');
		console.log('║         SOPHIA — INGESTION PIPELINE (RESUMING)              ║');
		console.log('╚══════════════════════════════════════════════════════════════╝');
		console.log('');
		console.log(`[RESUME] Previous status: ${existingLog.status}`);
		console.log(`[RESUME] Last completed stage: ${resumeFromStage || 'none'}`);
		if (existingLog.error_message) {
			console.log(`[RESUME] Previous error: ${existingLog.error_message}`);
		}
		console.log('');

		// Clear error state for retry
		await updateIngestionLog(db, sourceMeta.url, {
			status: 'extracting',
			error_message: undefined
		});
	} else {
		// Fresh start
		await createIngestionLog(db, sourceMeta.url, sourceMeta.title);
	}

	// --force-stage overrides the resume point regardless of what's in the DB log.
	// e.g. --force-stage embedding re-runs Stage 4 (embedding) and everything after.
	if (forceStage) {
		const forceIdx = STAGES_ORDER.indexOf(forceStage);
		resumeFromStage = forceIdx === 0 ? null : STAGES_ORDER[forceIdx - 1];
		console.log(`[FORCE] --force-stage ${forceStage}: overriding resume point to "${resumeFromStage ?? 'none'}"`);
	}

	// Load partial results from disk if resuming
	let partial: PartialResults;
	if (resumeFromStage) {
		const loaded = loadPartialResults(slug);
		if (loaded) {
			partial = loaded;
			const normalized = normalizeResumeStage(resumeFromStage, partial);
			if (normalized !== resumeFromStage) {
				console.log(
					`[RESUME] Partial data incomplete for stage "${resumeFromStage}" — rolling back resume point to "${normalized ?? 'none'}"`
				);
				resumeFromStage = normalized;
			}
			console.log(`[RESUME] Loaded partial results from disk (stage: ${loaded.stage_completed})`);
		} else {
			console.log('[RESUME] No partial results on disk — restarting from scratch');
			resumeFromStage = null;
			partial = { source: sourceMeta, stage_completed: 'none' };
		}
	} else {
		partial = { source: sourceMeta, stage_completed: 'none' };
	}

	const estimatedSourceTokens = estimateTokens(sourceText);
	const basePlanningContext = {
		sourceTitle: sourceMeta.title,
		sourceType: sourceMeta.source_type,
		estimatedTokens: estimatedSourceTokens,
		sourceLengthChars: sourceText.length,
		preferredProvider: ingestProvider
	} as const;
	let extractionPlan = await planIngestionStage('extraction', basePlanningContext);
	let relationPlan = await planIngestionStage('relations', basePlanningContext);
	let groupingPlan = await planIngestionStage('grouping', basePlanningContext);
	let validationPlan = await planIngestionStage('validation', basePlanningContext);
	let embeddingPlan = await planIngestionStage('embedding', basePlanningContext);
	let jsonRepairPlan = await planIngestionStage('json_repair', basePlanningContext);

	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║              SOPHIA — INGESTION PIPELINE                    ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log('');
	console.log(`Source: "${sourceMeta.title}"`);
	console.log(`Author: ${sourceMeta.author.join(', ') || 'Unknown'}`);
	console.log(`Type:   ${sourceMeta.source_type}`);
	console.log(`Words:  ${sourceMeta.word_count.toLocaleString()}`);
	console.log(`Est. tokens: ~${estimatedSourceTokens.toLocaleString()}`);
	console.log(`Passages: ${passages.length} (${extractionBatches.length} extraction batch${extractionBatches.length === 1 ? '' : 'es'})`);
	console.log(`Ingest provider hint: ${ingestProvider}`);
	console.log(`Extraction route: ${extractionPlan.provider}:${extractionPlan.model} (${extractionPlan.routingSource}) step=${extractionPlan.selectedStepId ?? '—'} switch=${extractionPlan.switchReasonCode ?? '—'}`);
	console.log(`Relations route:  ${relationPlan.provider}:${relationPlan.model} (${relationPlan.routingSource}) step=${relationPlan.selectedStepId ?? '—'} switch=${relationPlan.switchReasonCode ?? '—'}`);
	console.log(`Grouping route:   ${groupingPlan.provider}:${groupingPlan.model} (${groupingPlan.routingSource}) step=${groupingPlan.selectedStepId ?? '—'} switch=${groupingPlan.switchReasonCode ?? '—'}`);
	console.log(`Validation route: ${validationPlan.provider}:${validationPlan.model} (${validationPlan.routingSource}) step=${validationPlan.selectedStepId ?? '—'} switch=${validationPlan.switchReasonCode ?? '—'}`);
	console.log(`Embedding route:  ${embeddingPlan.provider}:${embeddingPlan.model} (${embeddingPlan.routingSource}) step=${embeddingPlan.selectedStepId ?? '—'} switch=${embeddingPlan.switchReasonCode ?? '—'}`);
	console.log(`Repair route:     ${jsonRepairPlan.provider}:${jsonRepairPlan.model} (${jsonRepairPlan.routingSource}) step=${jsonRepairPlan.selectedStepId ?? '—'} switch=${jsonRepairPlan.switchReasonCode ?? '—'}`);
	console.log(`Validate: ${shouldValidate ? 'YES (Gemini)' : 'No'}`);
	if (resumeFromStage) {
		console.log(`Resume from: ${resumeFromStage}`);
	}
	console.log('');

	try {
		// Resume: restore spend from partial checkpoint so [COST] totals/deltas stay cumulative across process restarts.
		if (resumeFromStage && partial.cost_usd_snapshot != null && partial.cost_usd_snapshot > 0) {
			costs.totalUsd = partial.cost_usd_snapshot;
			console.log(
				`  [COST_RESUME] Carried forward prior spend total=$${partial.cost_usd_snapshot.toFixed(4)} from checkpoint`
			);
		}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 1: CLAIM EXTRACTION
		// ═══════════════════════════════════════════════════════════════
			let allClaims: PhaseOneClaim[] = [];
			const extractionTracker = startStageUsage('extraction');
			const repairTracker = startStageUsage('json_repair');

			if (shouldRunStage('extracting', resumeFromStage)) {
				await updateIngestionLog(db, sourceMeta.url, { status: 'extracting' });

				console.log('┌──────────────────────────────────────────────────────────┐');
				console.log('│ STAGE 1: CLAIM EXTRACTION                               │');
				console.log('└──────────────────────────────────────────────────────────┘');
				if (passages.length === 0 || extractionBatches.length === 0) {
					throw new Error('[INTEGRITY] Passage segmentation produced 0 extraction batches');
				}
				console.log(
					`  [INFO] Segmented into ${passages.length} argumentative passages across ${extractionBatches.length} extraction batch(es)`
				);

				let batchQueue: PassageRecord[][] = extractionBatches.map((batch) => [...batch]);
				let batchLabel = 0;

				if (partial.extraction_progress?.claims_so_far.length > 0) {
					if (Array.isArray(partial.extraction_progress.remaining_batches)) {
						const remainingBatches = partial.extraction_progress.remaining_batches;
						console.log(
							`  [RESUME] Mid-extraction checkpoint — ${partial.extraction_progress.claims_so_far.length} claims already extracted`
						);
						console.log(
							`  [RESUME] Skipping ${extractionBatches.length - remainingBatches.length} completed batches`
						);
						allClaims = ensurePhaseOneClaims(
							partial.extraction_progress.claims_so_far,
							passages,
							sourceMeta
						);
						allClaims = normalizeSequentialClaimPositions(allClaims);
						batchQueue = remainingBatches;
						batchLabel = extractionBatches.length - batchQueue.length;
						if (batchQueue.length === 0) {
							console.log(
								`  [RESUME] All ${extractionBatches.length} batches already extracted; skipping to stage completion`
							);
						}
					} else {
						console.log(
							'  [RESUME] Legacy extraction checkpoint detected without passage batches; restarting Stage 1 from scratch'
						);
						partial.extraction_progress = undefined;
					}
				}

				for (let i = 0; i < batchQueue.length; i++) {
					const batch = batchQueue[i];
					batchLabel++;
					const renderedBatch = renderPassageBatch(batch);
					const queuePos = i + 1;
					const queueTotal = batchQueue.length;
					const passagesTotalSegmented = passages.length;
					const passagesAfterThisBatch = batchQueue
						.slice(i + 1)
						.reduce((sum, b) => sum + b.length, 0);
					const extractionProgressSuffix = ` · ${passagesAfterThisBatch} passage(s) left after this batch · ${passagesTotalSegmented} segmented total`;
					console.log(
						`\n  [BATCH ${batchLabel}] (${queuePos}/${queueTotal}) ${batch.length} passage(s) (~${estimateTokens(renderedBatch).toLocaleString()} tokens)${extractionProgressSuffix}`
					);

					const userMsg = EXTRACTION_USER(
						`${sourceMeta.title} (Batch ${batchLabel})`,
						sourceMeta.author.join(', ') || 'Unknown',
						renderedBatch
					);

					let rawResponse: string;
					try {
						rawResponse = await callStageModelWithProgress({
							stage: 'extraction',
							plan: extractionPlan,
							budget: extractionBudget,
							tracker: extractionTracker,
							systemPrompt: EXTRACTION_SYSTEM,
							userMessage: userMsg,
							label: `Extracting batch ${batchLabel} (${queuePos}/${queueTotal})`
						});
					} catch (apiError) {
						const apiMsg = apiError instanceof Error ? apiError.message : String(apiError);
						if (apiMsg.includes('truncated (max_tokens reached)') && batch.length > 1) {
							const mid = Math.ceil(batch.length / 2);
							batchQueue.splice(i + 1, 0, batch.slice(0, mid), batch.slice(mid));
							const passagesInQueue = batchQueue.reduce((sum, b) => sum + b.length, 0);
							console.warn(
								`  [SPLIT] Batch ${batchLabel} truncated — splitting into 2 smaller passage batches (queue now ${batchQueue.length} batch(es), ${passagesInQueue} passage(s) in queue)`
							);
							batchLabel--;
							continue;
						}
						throw apiError;
					}
					logStageCost('Extraction', extractionTracker, extractionPlan);

					try {
						const parsed = parseJsonResponse(rawResponse);
						const validated = ExtractionOutputSchema.parse(
							normalizeExtractionPayload(parsed, domainOverride)
						);
						const offsetClaims = attachPassageMetadataToClaims(
							validated,
							batch,
							allClaims.length,
							sourceMeta
						);

						allClaims.push(...offsetClaims);
						console.log(
							`  [OK] Extracted ${validated.length} claims from batch ${batchLabel} (${queuePos}/${queueTotal} in queue)`
						);

						partial.extraction_progress = {
							claims_so_far: [...allClaims],
							remaining_batches: batchQueue.slice(i + 1)
						};
						savePartialResults(slug, partial);
					} catch (parseError) {
						console.warn(
							`  [WARN] JSON parse/validation failed for batch ${batchLabel}. Attempting fix...`
						);

						let fixedResponse: string;
						try {
							fixedResponse = await fixJsonWithModel(
								jsonRepairPlan,
								jsonRepairBudget,
								repairTracker,
								rawResponse,
								parseError instanceof Error ? parseError.message : String(parseError),
								'Array of { text, claim_type, domain, passage_id, section_context, position_in_source, confidence }'
							);
						} catch (fixError) {
							const fixMsg = fixError instanceof Error ? fixError.message : String(fixError);
							if (fixMsg.includes('truncated (max_tokens reached)') && batch.length > 1) {
								const mid = Math.ceil(batch.length / 2);
								batchQueue.splice(i + 1, 0, batch.slice(0, mid), batch.slice(mid));
								const passagesInQueue = batchQueue.reduce((sum, b) => sum + b.length, 0);
								console.warn(
									`  [SPLIT] Batch ${batchLabel} repair response truncated — splitting into 2 smaller passage batches (queue now ${batchQueue.length} batch(es), ${passagesInQueue} passage(s) in queue)`
								);
								batchLabel--;
								continue;
							}
							throw fixError;
						}

						const fixedParsed = parseJsonResponse(fixedResponse);
						const fixedValidated = ExtractionOutputSchema.parse(
							normalizeExtractionPayload(fixedParsed, domainOverride)
						);
						const fixedClaims = attachPassageMetadataToClaims(
							fixedValidated,
							batch,
							allClaims.length,
							sourceMeta
						);
						allClaims.push(...fixedClaims);
						console.log(
							`  [OK] Fixed and extracted ${fixedValidated.length} claims from batch ${batchLabel} (${queuePos}/${queueTotal} in queue)`
						);

						partial.extraction_progress = {
							claims_so_far: [...allClaims],
							remaining_batches: batchQueue.slice(i + 1)
						};
						savePartialResults(slug, partial);
					}
				}

				allClaims = normalizeSequentialClaimPositions(allClaims);

				// Print breakdown
				const claimTypeBreakdown: Record<string, number> = {};
			for (const claim of allClaims) {
				claimTypeBreakdown[claim.claim_type] = (claimTypeBreakdown[claim.claim_type] || 0) + 1;
			}
			console.log(`\n  Claims by type:`);
				for (const [type, count] of Object.entries(claimTypeBreakdown).sort((a, b) => b[1] - a[1])) {
					console.log(`    ${type}: ${count}`);
				}
				assertClaimIntegrity(allClaims);
				assertFiniteCostEstimate();

				partial.claims = allClaims;
				partial.stage_completed = 'extracting';
			partial.extraction_progress = undefined; // Clear mid-stage progress — extraction is now complete
			savePartialResults(slug, partial);
			await updateIngestionLog(db, sourceMeta.url, {
				stage_completed: 'extracting',
				claims_extracted: allClaims.length,
				cost_usd: parseFloat(estimateCostUsd())
			});
			} else {
				console.log('  [SKIP] Stage 1: Extraction (already completed)\n');
				if (!Array.isArray(partial.claims) || partial.claims.length === 0) {
					throw new Error('Resume data missing claims for skipped Stage 1; rerun without resume or regenerate partial results');
				}
				allClaims = ensurePhaseOneClaims(partial.claims, passages, sourceMeta);
				allClaims = normalizeSequentialClaimPositions(allClaims);
			}

			assertClaimIntegrity(allClaims);
			relationPlan = await planIngestionStage('relations', {
				...basePlanningContext,
				claimCount: allClaims.length
			});
			groupingPlan = await planIngestionStage('grouping', {
				...basePlanningContext,
				claimCount: allClaims.length
			});
			validationPlan = await planIngestionStage('validation', {
				...basePlanningContext,
				claimCount: allClaims.length
			});
			embeddingPlan = await planIngestionStage('embedding', {
				...basePlanningContext,
				claimCount: allClaims.length,
				claimTextChars: allClaims.reduce((sum, claim) => sum + claim.text.length, 0)
			});

		// ═══════════════════════════════════════════════════════════════
		// STAGE 2: RELATION EXTRACTION
		// ═══════════════════════════════════════════════════════════════
			let relations: PhaseOneRelation[] = [];
		const relationsTracker = startStageUsage('relations');

		if (shouldRunStage('relating', resumeFromStage)) {
			await updateIngestionLog(db, sourceMeta.url, { status: 'relating' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 2: RELATION EXTRACTION                            │');
			console.log('└──────────────────────────────────────────────────────────┘');

			const relationsBatches = buildRelationsBatches(
				allClaims,
				RELATIONS_BATCH_TARGET_TOKENS,
				RELATIONS_BATCH_OVERLAP_CLAIMS
			);

			console.log(
				`  [INFO] Relations in ${relationsBatches.length} batch(es), target ~${RELATIONS_BATCH_TARGET_TOKENS.toLocaleString()} tokens (overlap ${RELATIONS_BATCH_OVERLAP_CLAIMS} claim(s))`
			);

			let startBatchIndex = 0;
			if (
				partial.relations_progress &&
				Array.isArray(partial.relations_progress.relations_so_far) &&
				partial.relations_progress.total_batches === relationsBatches.length &&
				partial.relations_progress.next_batch_index > 0
			) {
				relations = partial.relations_progress.relations_so_far;
				startBatchIndex = Math.min(partial.relations_progress.next_batch_index, relationsBatches.length);
				console.log(
					`  [RESUME] Mid-relations checkpoint — ${relations.length} relations so far; resuming at batch ${startBatchIndex + 1}/${relationsBatches.length}`
				);
			}

			for (let batchIndex = startBatchIndex; batchIndex < relationsBatches.length; batchIndex++) {
				const batchClaims = relationsBatches[batchIndex]!;
				const claimsJson = JSON.stringify(batchClaims, null, 2);
				const relUserMsg = RELATIONS_USER(claimsJson);

				console.log(
					`  [BATCH ${batchIndex + 1}/${relationsBatches.length}] ${batchClaims.length} claims (~${estimateTokens(
						claimsJson
					).toLocaleString()} tokens claim JSON)`
				);

				const relRawResponse = await callStageModel({
					stage: 'relations',
					plan: relationPlan,
					budget: relationBudget,
					tracker: relationsTracker,
					systemPrompt: RELATIONS_SYSTEM,
					userMessage: relUserMsg
				});
				logStageCost('Relations', relationsTracker, relationPlan);

				let batchRelations: PhaseOneRelation[] = [];
				try {
					const parsed = parseJsonResponse(relRawResponse);
					batchRelations = attachRelationMetadata(RelationsOutputSchema.parse(parsed), allClaims);
					console.log(`  [OK] Identified ${batchRelations.length} relations in batch ${batchIndex + 1}`);
				} catch (parseError) {
					console.warn('  [WARN] JSON parse/validation failed. Attempting fix...');
					const fixedResponse = await fixJsonWithModel(
						jsonRepairPlan,
						jsonRepairBudget,
						repairTracker,
						relRawResponse,
						parseError instanceof Error ? parseError.message : String(parseError),
						'Array of { from_position, to_position, relation_type, strength, note? }'
					);
					const fixedParsed = parseJsonResponse(fixedResponse);
					batchRelations = attachRelationMetadata(RelationsOutputSchema.parse(fixedParsed), allClaims);
					console.log(
						`  [OK] Fixed and identified ${batchRelations.length} relations in batch ${batchIndex + 1}`
					);
				}

				relations = mergeRelationsDedup(relations, batchRelations);

				partial.relations = relations;
				partial.relations_progress = {
					relations_so_far: relations,
					next_batch_index: batchIndex + 1,
					total_batches: relationsBatches.length
				};
				partial.stage_completed = 'relating';
				savePartialResults(slug, partial);
			}

			// Print breakdown
			const relTypeBreakdown: Record<string, number> = {};
			for (const rel of relations) {
				relTypeBreakdown[rel.relation_type] = (relTypeBreakdown[rel.relation_type] || 0) + 1;
			}
			console.log(`\n  Relations by type:`);
			for (const [type, count] of Object.entries(relTypeBreakdown).sort((a, b) => b[1] - a[1])) {
				console.log(`    ${type}: ${count}`);
			}

			assertRelationIntegrity(relations, allClaims);
			assertFiniteCostEstimate();

			partial.relations = relations;
			partial.relations_progress = undefined;
			partial.stage_completed = 'relating';
			savePartialResults(slug, partial);

			await updateIngestionLog(db, sourceMeta.url, {
				stage_completed: 'relating',
				relations_extracted: relations.length,
				cost_usd: parseFloat(estimateCostUsd())
			});
		} else {
			console.log('  [SKIP] Stage 2: Relations (already completed)\n');
			if (!Array.isArray(partial.relations)) {
				throw new Error('Resume data missing relations for skipped Stage 2; rerun from Stage 2');
			}
			relations = partial.relations;
		}

			groupingPlan = await planIngestionStage('grouping', {
				...basePlanningContext,
				claimCount: allClaims.length,
				relationCount: relations.length
			});
			validationPlan = await planIngestionStage('validation', {
				...basePlanningContext,
				claimCount: allClaims.length,
				relationCount: relations.length
			});

		// ═══════════════════════════════════════════════════════════════
		// STAGE 3: ARGUMENT GROUPING
		// ═══════════════════════════════════════════════════════════════
		let arguments_: GroupingOutput = [];
		const groupingTracker = startStageUsage('grouping');

		if (shouldRunStage('grouping', resumeFromStage)) {
			await updateIngestionLog(db, sourceMeta.url, { status: 'grouping' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 3: ARGUMENT GROUPING                              │');
			console.log('└──────────────────────────────────────────────────────────┘');

				const groupingBatches = buildGroupingBatches(
					allClaims,
					relations,
					GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS
				);
				console.log(
					`  [INFO] Grouping in ${groupingBatches.length} batch(es), target ~${GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS.toLocaleString()} tokens`
				);
				let groupedOutputs: GroupingOutput[] = [];
				let startGroupingBatchIndex = 0;
				if (
					partial.grouping_progress?.grouped_outputs_so_far &&
					partial.grouping_progress.next_batch_index > 0 &&
					partial.grouping_progress.next_batch_index <= groupingBatches.length
				) {
					groupedOutputs = partial.grouping_progress.grouped_outputs_so_far;
					startGroupingBatchIndex = partial.grouping_progress.next_batch_index;
					console.log(
						`  [RESUME] Mid-grouping checkpoint — resuming at batch ${startGroupingBatchIndex + 1}/${groupingBatches.length}`
					);
				}

				for (let batchIndex = startGroupingBatchIndex; batchIndex < groupingBatches.length; batchIndex++) {
					const batch = groupingBatches[batchIndex];
					const claimsJson = JSON.stringify(batch.claims, null, 2);
					const relationsJson = JSON.stringify(batch.relations, null, 2);
					console.log(
						`  [BATCH ${batchIndex + 1}/${groupingBatches.length}] ${batch.claims.length} claims, ${batch.relations.length} relations (~${estimateTokens(claimsJson).toLocaleString()} claim tokens)`
					);
					const grpUserMsg = GROUPING_USER(claimsJson, relationsJson);
					const grpRawResponse = await callStageModel({
						stage: 'grouping',
						plan: groupingPlan,
						budget: groupingBudget,
						tracker: groupingTracker,
						systemPrompt: GROUPING_SYSTEM,
						userMessage: grpUserMsg
					});
					saveGroupingDebugRaw(slug, batchIndex, grpRawResponse);
					logStageCost('Grouping', groupingTracker, groupingPlan);

					try {
						const parsed = parseJsonResponse(grpRawResponse);
						const batchArguments = GroupingOutputSchema.parse(normalizeGroupingPayload(parsed));
						groupedOutputs.push(batchArguments);
						console.log(
							`  [OK] Identified ${batchArguments.length} arguments in batch ${batchIndex + 1}`
						);
					} catch (parseError) {
						console.warn(
							`  [WARN] JSON parse/validation failed for grouping batch ${batchIndex + 1}. Attempting fix...`
						);
						const fixedResponse = await fixJsonWithModel(
							jsonRepairPlan,
							jsonRepairBudget,
							repairTracker,
							grpRawResponse,
							parseError instanceof Error ? parseError.message : String(parseError),
							'Array of { name, tradition?, domain, summary, claims: [{ position_in_source, role }] }'
						);
						const fixedParsed = parseJsonResponse(fixedResponse);
						const fixedArguments = GroupingOutputSchema.parse(normalizeGroupingPayload(fixedParsed));
						groupedOutputs.push(fixedArguments);
						console.log(
							`  [OK] Fixed and identified ${fixedArguments.length} arguments in batch ${batchIndex + 1}`
						);
					}

					partial.grouping_progress = {
						grouped_outputs_so_far: groupedOutputs,
						next_batch_index: batchIndex + 1,
						total_batches: groupingBatches.length
					};
					savePartialResults(slug, partial);
				}

				arguments_ = mergeGroupingOutputs(groupedOutputs);
				console.log(`  [OK] Merged into ${arguments_.length} unique arguments`);
				const groupingHealth = analyzeGroupingReferenceHealth(arguments_);
				console.log(
					`  [CHECK] Grouping refs: ${groupingHealth.totalReferences} refs across ${groupingHealth.uniquePositions} unique claim positions`
				);
				if (groupingHealth.collapsed) {
					const collapseMessage =
						`[INTEGRITY] Stage 3 grouping claim references collapsed (position=1 refs: ${groupingHealth.positionOneReferences}/${groupingHealth.totalReferences}, unique positions: ${groupingHealth.uniquePositions}). ` +
						`Likely model output degeneration or malformed position references.`;
					if (INGEST_FAIL_ON_GROUPING_POSITION_COLLAPSE) {
						throw new Error(collapseMessage);
					}
					console.warn(`  [WARN] ${collapseMessage}`);
				}

				console.log(`\n  Named arguments:`);
			for (const arg of arguments_) {
				console.log(`    • ${arg.name} (${arg.domain}, ${arg.claims.length} claims)`);
			}

			partial.arguments = arguments_;
			partial.grouping_progress = undefined;
			partial.stage_completed = 'grouping';
			savePartialResults(slug, partial);
			await updateIngestionLog(db, sourceMeta.url, {
				stage_completed: 'grouping',
				arguments_grouped: arguments_.length,
				cost_usd: parseFloat(estimateCostUsd())
			});
		} else {
			console.log('  [SKIP] Stage 3: Grouping (already completed)\n');
			if (!Array.isArray(partial.arguments)) {
				throw new Error('Resume data missing arguments for skipped Stage 3; rerun from Stage 3');
			}
			arguments_ = partial.arguments;
			}
			validationPlan = await planIngestionStage('validation', {
				...basePlanningContext,
				claimCount: allClaims.length,
				relationCount: relations.length,
				argumentCount: arguments_.length
			});

		// ═══════════════════════════════════════════════════════════════
		// STAGE 4: EMBEDDING
		// ═══════════════════════════════════════════════════════════════
		let allEmbeddings: number[][] = [];
		const embeddingTracker = startStageUsage('embedding');

		if (shouldRunStage('embedding', resumeFromStage)) {
			await updateIngestionLog(db, sourceMeta.url, { status: 'embedding' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 4: EMBEDDING (Vertex AI text-embedding-005)        │');
			console.log('└──────────────────────────────────────────────────────────┘');

			const claimTexts = allClaims.map((c) => c.text);
			if (embeddingPlan.provider !== 'vertex') {
				throw new Error('Embedding model profile currently supports only vertex provider');
			}
			console.log(
				`  Embedding ${claimTexts.length} claims via ${embeddingPlan.model} (${EMBEDDING_DIMENSIONS}-dim)...`
			);

			allEmbeddings = await withTimeout(
				embedTexts(claimTexts),
				embeddingBudget.timeoutMs,
				`embedding ${embeddingPlan.model}`
			);

			const totalChars = claimTexts.reduce((sum, t) => sum + t.length, 0);
			trackEmbeddingCost(totalChars);
			assertStageBudget(embeddingBudget, embeddingTracker);

			console.log(`  [OK] Generated ${allEmbeddings.length} embeddings (${EMBEDDING_DIMENSIONS} dimensions)`);
			logStageCost('Embedding', embeddingTracker, embeddingPlan);

			partial.embeddings = allEmbeddings;
			partial.stage_completed = 'embedding';
			savePartialResults(slug, partial);
			await updateIngestionLog(db, sourceMeta.url, {
				stage_completed: 'embedding',
				cost_usd: parseFloat(estimateCostUsd())
			});
		} else {
			console.log('  [SKIP] Stage 4: Embedding (already completed)\n');
			if (!Array.isArray(partial.embeddings)) {
				throw new Error('Resume data missing embeddings for skipped Stage 4; rerun from Stage 4');
			}
			allEmbeddings = partial.embeddings;
		}

		// ── Pipeline handoff point ─────────────────────────────────────
		// When running in pipelined mode, stop here so the batch can start
		// the next source's Claude extraction while Gemini validates this one.
		if (stopAfterEmbedding) {
			console.log('\n  [PIPELINE] Stages 1-4 complete. Handing off to Gemini+Store phase.');
			await updateIngestionLog(db, sourceMeta.url, {
				status: 'validating',
				stage_completed: 'embedding',
				cost_usd: parseFloat(estimateCostUsd())
			});
			await db.close();
			process.exit(0);
		}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 5: CROSS-MODEL VALIDATION (optional)
		// ═══════════════════════════════════════════════════════════════
		let validationResult: ValidationOutput | null = null;

		if (shouldRunStage('validating', resumeFromStage)) {
			if (shouldValidate) {
				await updateIngestionLog(db, sourceMeta.url, { status: 'validating' });

				console.log('\n┌──────────────────────────────────────────────────────────┐');
				console.log('│ STAGE 5: CROSS-MODEL VALIDATION                         │');
				console.log('└──────────────────────────────────────────────────────────┘');
				const validationTracker = startStageUsage('validation');

				const validationBatches = buildValidationBatches(
					allClaims,
					relations,
					arguments_,
					sourceText,
					sourceMeta.title,
					VALIDATION_BATCH_TARGET_TOKENS
				);
				console.log(
					`  [INFO] Validation in ${validationBatches.length} batch(es), target ~${VALIDATION_BATCH_TARGET_TOKENS.toLocaleString()} tokens`
				);
				let batchOutputs: ValidationOutput[] = [];
				let startValidationBatchIndex = 0;
				if (
					partial.validation_progress?.should_validate &&
					partial.validation_progress.batch_outputs_so_far &&
					partial.validation_progress.next_batch_index > 0 &&
					partial.validation_progress.next_batch_index <= validationBatches.length
				) {
					batchOutputs = partial.validation_progress.batch_outputs_so_far;
					startValidationBatchIndex = partial.validation_progress.next_batch_index;
					console.log(
						`  [RESUME] Mid-validation checkpoint — resuming at batch ${startValidationBatchIndex + 1}/${validationBatches.length}`
					);
				}

				for (let batchIndex = startValidationBatchIndex; batchIndex < validationBatches.length; batchIndex++) {
					const batch = validationBatches[batchIndex];
					const claimsJson = JSON.stringify(batch.claims, null, 2);
					const relationsJson = JSON.stringify(batch.relations, null, 2);
					const argumentsJson = JSON.stringify(batch.arguments, null, 2);
					console.log(
						`  [BATCH ${batchIndex + 1}/${validationBatches.length}] ${batch.claims.length} claims, ${batch.relations.length} relations, ${batch.arguments.length} arguments (~${batch.estimatedPromptTokens.toLocaleString()} est tokens)`
					);
					const validationPrompt =
						VALIDATION_SYSTEM +
						'\n\n' +
						VALIDATION_USER({
							sourceTitle: sourceMeta.title,
							sourceText: batch.sourceText,
							claimsJson,
							relationsJson,
							argumentsJson
						});

					try {
						const responseText = await callStageModel({
							stage: 'validation',
							plan: validationPlan,
							budget: validationBudget,
							tracker: validationTracker,
							systemPrompt: 'You are a strict validation assistant. Return JSON only.',
							userMessage: validationPrompt
						});
						try {
							const parsed = parseJsonResponse(responseText);
							const validated = normalizeValidationOutput(parsed);
							batchOutputs.push(validated);
							console.log(
								`  [OK] Validation batch ${batchIndex + 1} complete (${validated.claims?.length || 0} claim checks)`
							);
						} catch (parseError) {
							console.warn(
								`  [WARN] JSON parse/validation failed for validation batch ${batchIndex + 1}. Attempting fix...`
							);
							const fixedResponse = await fixJsonWithModel(
								jsonRepairPlan,
								jsonRepairBudget,
								repairTracker,
								responseText,
								parseError instanceof Error ? parseError.message : String(parseError),
								'Object with { claims?, relations?, arguments?, quarantine_items?, summary }'
							);
							const fixedParsed = parseJsonResponse(fixedResponse);
							const fixedValidated = normalizeValidationOutput(fixedParsed);
							batchOutputs.push(fixedValidated);
							console.log(
								`  [OK] Repaired and validated batch ${batchIndex + 1} (${fixedValidated.claims?.length || 0} claim checks)`
							);
						}
					} catch (batchError) {
						const err = batchError instanceof Error ? batchError : new Error(String(batchError));
						console.warn(
							`  [WARN] Validation batch ${batchIndex + 1} failed after model fallbacks. Continuing.`
						);
						console.warn(`  Error: ${err.message}`);
					}
					partial.validation_progress = {
						batch_outputs_so_far: batchOutputs,
						next_batch_index: batchIndex + 1,
						total_batches: validationBatches.length,
						should_validate: true
					};
					savePartialResults(slug, partial);
				}

				logStageCost('Validation', validationTracker, validationPlan);

				if (batchOutputs.length > 0) {
					validationResult = mergeValidationOutputs(batchOutputs);
				} else {
					console.warn('  [WARN] Validation produced no successful batch outputs; continuing without validation.');
				}

				if (validationResult) {
					const claimScores = validationResult.claims?.map((c) => c.faithfulness_score) || [];
					const avgScore =
						claimScores.length > 0
							? Math.round(claimScores.reduce((a, b) => a + b, 0) / claimScores.length)
							: 0;
					const quarantined = validationResult.quarantine_items?.length || 0;

					console.log(`  [OK] Validation complete`);
					console.log(`  Average faithfulness score: ${avgScore}/100`);
					console.log(`  Quarantined items: ${quarantined}`);
					console.log(`  Summary: ${validationResult.summary}`);

					if (avgScore < 60) {
						console.warn('\n  ⚠️  WARNING: Quality score below 60. Manual review recommended.');
					}
				}
			} else {
				console.log('\n  [SKIP] Stage 5: Validation (use --validate flag to enable)');
				partial.validation_progress = undefined;
			}

			partial.validation = validationResult;
			partial.validation_progress = undefined;
			partial.stage_completed = 'validating';
			savePartialResults(slug, partial);

			const valScore = validationResult?.claims?.length
				? validationResult.claims.reduce((a, b) => a + b.faithfulness_score, 0) / validationResult.claims.length
				: undefined;

			await updateIngestionLog(db, sourceMeta.url, {
				stage_completed: 'validating',
				validation_score: valScore,
				cost_usd: parseFloat(estimateCostUsd())
			});
		} else {
			console.log('  [SKIP] Stage 5: Validation (already completed)\n');
			validationResult = partial.validation ?? null;
		}

		if (stopBeforeStore) {
			console.log(
				'\n  [PHASE] Stages 1–5 complete. Resume this source without --stop-before-store (or use admin Sync) to run Stage 6 (SurrealDB).'
			);
			savePartialResults(slug, partial);
			await updateIngestionLog(db, sourceMeta.url, {
				status: 'validating',
				stage_completed: 'validating',
				cost_usd: parseFloat(estimateCostUsd())
			});
			await db.close();
			process.exit(0);
		}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 6: STORE IN SURREALDB
		// ═══════════════════════════════════════════════════════════════
		if (shouldRunStage('storing', resumeFromStage)) {
			// ── Pre-stage 6 health check ──────────────────────────────
			// Stages 1–5 can take 20+ minutes; verify the DB session is still
			// alive before beginning the critical write phase.
			console.log('\n  [CHECK] Verifying DB connection before store...');
			await ensureDbConnected(db);

			await updateIngestionLog(db, sourceMeta.url, { status: 'storing' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 6: STORE IN SURREALDB                             │');
			console.log('└──────────────────────────────────────────────────────────┘');

			// DB connection already established at startup — reuse it
			console.log('  [OK] Using existing SurrealDB connection');

			// 6a. Remove any existing source data for this URL (idempotent re-run safety)
			console.log('  Checking for existing source data...');
			const RELATION_TABLES_ALL = [
				'supports',
				'contradicts',
				'depends_on',
				'responds_to',
				'defines',
				'qualifies',
				'refines',
				'exemplifies'
			];
			const existingSources = await db.query<[{ id: string }[]]>(
				'SELECT id FROM source WHERE canonical_url_hash = $canonical_url_hash OR url = $url LIMIT 1',
				{ canonical_url_hash: sourceMeta.canonical_url_hash, url: sourceMeta.url }
			);
			const existingSourceId = Array.isArray(existingSources) && existingSources.length > 0
				? Array.isArray(existingSources[0]) ? existingSources[0][0]?.id : (existingSources[0] as any)?.id
				: null;
				if (existingSourceId) {
					console.log(`  [CLEANUP] Removing existing source (${existingSourceId}) and its claims/arguments...`);
				// Remove relation edges among claims of this source
				for (const relTable of RELATION_TABLES_ALL) {
					await db.query(
						`DELETE ${relTable} WHERE in IN (SELECT id FROM claim WHERE source = $sid) OR out IN (SELECT id FROM claim WHERE source = $sid)`,
						{ sid: existingSourceId }
					);
				}
					await db.query('DELETE part_of WHERE in IN (SELECT id FROM claim WHERE source = $sid)', { sid: existingSourceId });
					await db.query('DELETE claim WHERE source = $sid', { sid: existingSourceId });
					await db.query('DELETE passage WHERE source = $sid', { sid: existingSourceId });
					await db.query('DELETE argument WHERE source = $sid', { sid: existingSourceId });
					await db.query('DELETE source WHERE id = $sid', { sid: existingSourceId });
					console.log('  [CLEANUP] Existing data removed — proceeding with fresh store');
			} else {
				console.log('  [OK] No existing data found — fresh store');
			}

			// 6b. Create source record
			console.log('  Creating source record...');
			const sourceRecord = await db.query<[{ id: string }[]]>(
				`CREATE source CONTENT {
					title: $title,
					author: $author,
					year: $year,
					source_type: $source_type,
					url: $url,
					canonical_url: $canonical_url,
					canonical_url_hash: $canonical_url_hash,
					visibility_scope: $visibility_scope,
					deletion_state: $deletion_state,
					ingested_at: time::now(),
					claim_count: $claim_count,
					status: $status
				}`,
				{
					title: sourceMeta.title,
					author: sourceMeta.author,
					year: sourceMeta.year ?? undefined,
					source_type: sourceMeta.source_type,
					url: sourceMeta.url,
					canonical_url: sourceMeta.canonical_url ?? undefined,
					canonical_url_hash: sourceMeta.canonical_url_hash ?? undefined,
					visibility_scope: sourceMeta.visibility_scope ?? undefined,
					deletion_state: sourceMeta.deletion_state ?? undefined,
					claim_count: allClaims.length,
					status: shouldValidate ? 'validated' : 'ingested'
				}
			);

			const sourceId =
				Array.isArray(sourceRecord) && sourceRecord.length > 0
					? Array.isArray(sourceRecord[0])
						? sourceRecord[0][0]?.id
						: (sourceRecord[0] as any)?.id
					: null;

			if (!sourceId) {
				throw new Error('Failed to create source record — no ID returned');
				}
				console.log(`  [OK] Source record: ${sourceId}`);

				// 6c. Create passage records
				console.log(`  Creating ${passages.length} passage records...`);
				const passageRecordIdMap: Map<string, string> = new Map();

				for (let i = 0; i < passages.length; i++) {
					if (i > 0 && i % 50 === 0) {
						await ensureDbConnected(db);
					}

					const passage = passages[i];
					const result = await db.query<[{ id: string }[]]>(
						`CREATE passage CONTENT {
							source: $source,
							text: $text,
							summary: $summary,
							section_title: $section_title,
							order_in_source: $order_in_source,
							span_start: $span_start,
							span_end: $span_end,
							role: $role,
							role_confidence: $role_confidence,
							review_state: $review_state,
							verification_state: $verification_state,
							extractor_version: $extractor_version
						}`,
						{
							source: sourceId,
							text: passage.text,
							summary: passage.summary,
							section_title: passage.section_title ?? undefined,
							order_in_source: passage.order_in_source,
							span_start: passage.span.start,
							span_end: passage.span.end,
							role: passage.role,
							role_confidence: passage.role_confidence,
							review_state:
								passage.role_confidence < LOW_CONFIDENCE_REVIEW_THRESHOLD
									? 'needs_review'
									: 'candidate',
							verification_state: 'unverified',
							extractor_version: INGEST_EXTRACTOR_VERSION
						}
					);
					const passageRecordId =
						Array.isArray(result) && result.length > 0
							? Array.isArray(result[0])
								? result[0][0]?.id
								: (result[0] as any)?.id
							: null;
					if (passageRecordId) {
						passageRecordIdMap.set(passage.id, passageRecordId);
					}
				}
				console.log(`  [OK] Created ${passageRecordIdMap.size} passage records`);

				// 6d. Create claim records with embeddings
				console.log(`  Creating ${allClaims.length} claim records...`);
				const claimIdMap: Map<number, string> = new Map(); // position_in_source → claim ID

			for (let i = 0; i < allClaims.length; i++) {
				// Re-check DB connection every 25 claims to catch session expiry early
				if (i > 0 && i % 25 === 0) {
					await ensureDbConnected(db);
				}

					const claim = allClaims[i];
					const embedding = allEmbeddings[i] || null;
					const validationClaim = validationResult?.claims?.find(
						(c) => c.position_in_source === claim.position_in_source
					);

					const result = await db.query<[{ id: string }[]]>(
						`CREATE claim CONTENT {
							text: $text,
							claim_type: $claim_type,
							domain: $domain,
							source: $source,
							passage: $passage,
							passage_order: $passage_order,
							passage_role: $passage_role,
							section_context: $section_context,
							position_in_source: $position_in_source,
							source_span_start: $source_span_start,
							source_span_end: $source_span_end,
							confidence: $confidence,
							embedding: $embedding,
							validation_score: $validation_score,
							claim_origin: $claim_origin,
							subdomain: $subdomain,
							thinker: $thinker,
							tradition: $tradition,
							era: $era,
							claim_scope: $claim_scope,
							attributed_to: $attributed_to,
							concept_tags: $concept_tags,
							review_state: $review_state,
							verification_state: $verification_state,
							extractor_version: $extractor_version,
							contested_terms: $contested_terms
						}`,
						{
							text: claim.text,
							claim_type: claim.claim_type,
							domain: domainOverride ?? claim.domain,
							source: sourceId,
							passage: claim.passage_id
								? passageRecordIdMap.get(claim.passage_id) ?? undefined
								: undefined,
							passage_order: claim.passage_order ?? undefined,
							passage_role: claim.passage_role ?? undefined,
							section_context: claim.section_context ?? undefined,
							position_in_source: claim.position_in_source,
							source_span_start: claim.source_span_start ?? undefined,
							source_span_end: claim.source_span_end ?? undefined,
							confidence: claim.confidence,
							embedding: embedding,
							validation_score: validationClaim?.faithfulness_score ?? undefined,
							claim_origin: claim.claim_origin,
							subdomain: claim.subdomain ?? undefined,
							thinker: claim.thinker ?? undefined,
							tradition: claim.tradition ?? undefined,
							era: claim.era ?? undefined,
							claim_scope: claim.claim_scope,
							attributed_to: claim.attributed_to.length > 0 ? claim.attributed_to : undefined,
							concept_tags: claim.concept_tags.length > 0 ? claim.concept_tags : undefined,
							review_state: claim.review_state,
							verification_state:
								validationClaim && validationClaim.faithfulness_score >= 80
									? 'validated'
									: claim.verification_state,
							extractor_version: claim.extractor_version,
							contested_terms: claim.contested_terms.length > 0 ? claim.contested_terms : undefined
						}
					);

				const claimId =
					Array.isArray(result) && result.length > 0
						? Array.isArray(result[0])
							? result[0][0]?.id
							: (result[0] as any)?.id
						: null;

				if (claimId) {
					claimIdMap.set(claim.position_in_source, claimId);
				}

				// Progress indicator
				if ((i + 1) % 20 === 0 || i === allClaims.length - 1) {
					process.stdout.write(`\r  [CLAIMS] ${i + 1}/${allClaims.length}`);
				}
			}
				console.log('');
				console.log(`  [OK] Created ${claimIdMap.size} claim records`);

				// 6e. Create relation records
			console.log(`  Creating ${relations.length} relation records...`);
			let relationsCreated = 0;

				for (const rel of relations) {
					const fromId = claimIdMap.get(rel.from_position);
					const toId = claimIdMap.get(rel.to_position);

					if (!fromId || !toId) {
						console.warn(
							`  [SKIP] Relation ${rel.from_position}->${rel.to_position}: missing claim ID`
						);
						continue;
					}

					try {
						let relQuery = `RELATE $from->${rel.relation_type}->$to`;
						const assignments = [
							'relation_confidence = $relation_confidence',
							'evidence_passages = $evidence_passages',
							'relation_inference_mode = $relation_inference_mode',
							'verification_state = $verification_state',
							'review_state = $review_state',
							'extractor_version = $extractor_version'
						];
						const vars: Record<string, unknown> = {
							from: fromId,
							to: toId,
							relation_confidence: rel.relation_confidence,
							evidence_passages: rel.evidence_passage_ids
								.map((passageId) => passageRecordIdMap.get(passageId))
								.filter((value): value is string => Boolean(value)),
							relation_inference_mode: rel.relation_inference_mode,
							verification_state: rel.verification_state,
							review_state: rel.review_state,
							extractor_version: rel.extractor_version
						};

						switch (rel.relation_type) {
							case 'supports':
							case 'contradicts': {
								assignments.unshift('strength = $strength');
								if (rel.note) assignments.push('note = $note');
								vars.strength = rel.strength;
								if (rel.note) vars.note = rel.note;
								break;
							}
							case 'depends_on': {
								const necessityMap: Record<string, string> = {
									strong: 'essential',
									moderate: 'supporting',
									weak: 'contextual'
								};
								assignments.unshift('necessity = $necessity');
								vars.necessity = necessityMap[rel.strength] || 'supporting';
								break;
							}
							case 'responds_to': {
								const responseMap: Record<string, string> = {
									strong: 'direct_rebuttal',
									moderate: 'undermining',
									weak: 'concession'
								};
								assignments.unshift('response_type = $response_type');
								vars.response_type = responseMap[rel.strength] || 'refinement';
								break;
							}
							case 'defines': {
								if (rel.note) {
									assignments.push('note = $note');
									vars.note = rel.note;
								}
								break;
							}
							case 'qualifies': {
								const qualificationMap: Record<string, string> = {
									strong: 'restrictive',
									moderate: 'conditional',
									weak: 'clarifying'
								};
								assignments.unshift('qualification_type = $qualification_type');
								vars.qualification_type = qualificationMap[rel.strength] || 'conditional';
								if (rel.note) {
									assignments.push('note = $note');
									vars.note = rel.note;
								}
								break;
							}
							default:
								break;
						}

						relQuery += ` SET ${assignments.join(', ')}`;
						await db.query(relQuery, vars);
						relationsCreated++;
					} catch (error) {
						console.warn(
							`  [SKIP] Failed to create relation ${rel.relation_type}: ${error instanceof Error ? error.message : String(error)}`
						);
					}
				}
				console.log(`  [OK] Created ${relationsCreated} relation records`);

				// 6f. Create argument records and part_of relations
			console.log(`  Creating ${arguments_.length} argument records...`);
			let argumentsCreated = 0;
			let partOfCreated = 0;

			for (const arg of arguments_) {
				try {
					const argResult = await db.query<[{ id: string }[]]>(
						`CREATE argument CONTENT {
							name: $name,
							summary: $summary,
							tradition: $tradition,
							domain: $domain,
							source: $source
						}`,
						{
							name: arg.name,
							summary: arg.summary,
							tradition: arg.tradition ?? undefined,
							domain: arg.domain,
							source: sourceId
						}
					);

					const argId =
						Array.isArray(argResult) && argResult.length > 0
							? Array.isArray(argResult[0])
								? argResult[0][0]?.id
								: (argResult[0] as any)?.id
							: null;

					if (!argId) {
						console.warn(`  [SKIP] No ID returned for argument: ${arg.name}`);
						continue;
					}

					argumentsCreated++;

					// Create part_of relations for claims in this argument
					for (const claimRef of arg.claims) {
						const claimId = claimIdMap.get(claimRef.position_in_source);
						if (!claimId) continue;

						try {
							await db.query(
								`RELATE $from->part_of->$to SET role = $role, position = $position`,
								{
									from: claimId,
									to: argId,
									role: claimRef.role,
									position: claimRef.position_in_source
								}
							);
							partOfCreated++;
						} catch {
							// Silently skip failed part_of relations
						}
					}
				} catch (error) {
					console.warn(
						`  [SKIP] Failed to create argument "${arg.name}": ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
			console.log(`  [OK] Created ${argumentsCreated} argument records`);
			console.log(`  [OK] Created ${partOfCreated} part_of relations`);

			// 6f. Update source record
			await db.query(`UPDATE $source SET claim_count = $count, status = $status`, {
				source: sourceId,
				count: allClaims.length,
				status: shouldValidate ? 'validated' : 'ingested'
			});
			console.log('  [OK] Source record updated');

			// ── Post-store verification ───────────────────────────────
			// Query DB to confirm expected counts are actually stored.
				console.log('  Verifying stored data...');
				const verifyPassageResult = await db.query<[{ count: number }[]]>(
					`SELECT count() AS count FROM passage WHERE source = $sid GROUP ALL`,
					{ sid: sourceId }
				);
				const verifyClaimResult = await db.query<[{ count: number }[]]>(
					`SELECT count() AS count FROM claim WHERE source = $sid GROUP ALL`,
					{ sid: sourceId }
			);
			const verifyArgResult = await db.query<[{ count: number }[]]>(
				`SELECT count() AS count FROM argument WHERE source = $sid GROUP ALL`,
				{ sid: sourceId }
			);
				const storedClaims =
					Array.isArray(verifyClaimResult?.[0]) ? (verifyClaimResult[0][0]?.count ?? 0) : 0;
				const storedPassages =
					Array.isArray(verifyPassageResult?.[0]) ? (verifyPassageResult[0][0]?.count ?? 0) : 0;
				const storedArgs =
					Array.isArray(verifyArgResult?.[0]) ? (verifyArgResult[0][0]?.count ?? 0) : 0;

				if (storedPassages !== passageRecordIdMap.size) {
					console.warn(
						`  [WARN] Passage count mismatch: expected ${passageRecordIdMap.size} in DB, found ${storedPassages}`
					);
				} else {
					console.log(`  [OK] Verified: ${storedPassages} passages in DB`);
				}
				if (storedClaims !== claimIdMap.size) {
					console.warn(
						`  [WARN] Claim count mismatch: expected ${claimIdMap.size} in DB, found ${storedClaims}`
				);
			} else {
				console.log(`  [OK] Verified: ${storedClaims} claims in DB`);
			}
			if (storedArgs !== argumentsCreated) {
				console.warn(
					`  [WARN] Argument count mismatch: expected ${argumentsCreated} in DB, found ${storedArgs}`
				);
			} else {
				console.log(`  [OK] Verified: ${storedArgs} arguments in DB`);
			}

			partial.stage_completed = 'stored';
			savePartialResults(slug, partial);
		} else {
			console.log('  [SKIP] Stage 6: Storage (already completed)\n');
		}

		// ═══════════════════════════════════════════════════════════════
		// MARK COMPLETE IN INGESTION LOG
		// ═══════════════════════════════════════════════════════════════
		const validationAvg = validationResult?.claims?.length
			? Math.round(
					(validationResult.claims.reduce((a, b) => a + b.faithfulness_score, 0) /
						validationResult.claims.length)
				)
			: null;

		await updateIngestionLog(db, sourceMeta.url, {
			status: 'complete',
			stage_completed: 'storing',
			claims_extracted: allClaims.length,
			relations_extracted: relations.length,
			arguments_grouped: arguments_.length,
			validation_score: validationAvg ?? undefined,
			cost_usd: parseFloat(estimateCostUsd()),
			completed_at: new Date()
		});

		await db.close();
		console.log('  [OK] Database connection closed');

		// ═══════════════════════════════════════════════════════════════
		// SUMMARY
		// ═══════════════════════════════════════════════════════════════
		console.log('\n╔══════════════════════════════════════════════════════════════╗');
		console.log('║                   INGESTION COMPLETE                        ║');
		console.log('╠══════════════════════════════════════════════════════════════╣');
		console.log(`║  Source:           ${sourceMeta.title.substring(0, 40).padEnd(40)} ║`);
		console.log(`║  Claims:           ${String(allClaims.length).padEnd(40)} ║`);
		console.log(`║  Relations:        ${String(relations.length).padEnd(40)} ║`);
		console.log(`║  Arguments:        ${String(arguments_.length).padEnd(40)} ║`);
		console.log(`║  Embeddings:       ${String(allEmbeddings.length).padEnd(40)} ║`);
		console.log(
			`║  Validation score: ${(validationAvg !== null ? `${validationAvg}/100` : 'skipped').padEnd(40)} ║`
		);
		console.log('╠══════════════════════════════════════════════════════════════╣');
		console.log(
			`║  Reasoning tokens: ${`${costs.totalInputTokens.toLocaleString()} in / ${costs.totalOutputTokens.toLocaleString()} out`.padEnd(40)} ║`
		);
		console.log(
			`║  Vertex chars:     ${costs.vertexChars.toLocaleString().padEnd(40)} ║`
		);
		console.log(
			`║  Estimated cost:   £${estimateCost()} ($${estimateCostUsd()})${' '.repeat(Math.max(0, 37 - estimateCost().length - estimateCostUsd().length))} ║`
		);
		console.log('╚══════════════════════════════════════════════════════════════╝');
		console.log('');

		process.exit(0);
	} catch (error) {
		console.error('\n[FATAL ERROR]', error instanceof Error ? error.message : String(error));
		if (error instanceof Error && error.stack) {
			console.error(error.stack);
		}

		// Update ingestion log with failure
		try {
			await updateIngestionLog(db, sourceMeta.url, {
				status: 'failed',
				error_message: error instanceof Error ? error.message : String(error),
				cost_usd: parseFloat(estimateCostUsd())
			});
		} catch {
			// If we can't update the log, we still want to save partial results
		}

		savePartialResults(slug, partial);

		try {
			await db.close();
		} catch {
			// ignore
		}

		process.exit(1);
	}
}

main();
