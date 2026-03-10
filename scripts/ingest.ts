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
import Anthropic from '@anthropic-ai/sdk';
import { Surreal } from 'surrealdb';
import { generateText } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex';
import { embedTexts, EMBEDDING_DIMENSIONS } from '../src/lib/server/embeddings.js';
import { z } from 'zod';
import { startSpinner, startStageTimer, renderProgressBar, IS_TTY } from './progress.js';

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
	ValidationOutputSchema,
	type ValidationOutput
} from '../src/lib/server/prompts/validation.js';
import { BatchInserter } from '../src/lib/server/batch-inserter.js';

// ─── Configuration ─────────────────────────────────────────────────────────
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const INGEST_VERTEX_MODEL = process.env.INGEST_VERTEX_MODEL || 'gemini-2.0-flash';
const INGEST_PROVIDER_DEFAULT = (process.env.INGEST_PROVIDER || 'vertex').toLowerCase();

const CLAUDE_MODELS = parseModelList(process.env.CLAUDE_MODELS, [
	CLAUDE_MODEL,
	'claude-sonnet-4-5-20250929'
]);

const INGEST_VERTEX_MODELS = parseModelList(process.env.INGEST_VERTEX_MODELS, [
	INGEST_VERTEX_MODEL,
	'gemini-2.0-flash',
	'gemini-2.5-flash',
	'gemini-2.5-pro'
]);

const GEMINI_MODELS = parseModelList(process.env.GEMINI_MODELS, [
	GEMINI_MODEL,
	'gemini-2.5-flash',
	'gemini-2.0-flash-001',
	'gemini-flash-latest',
	'gemini-2.5-pro'
]);

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const GOOGLE_VERTEX_PROJECT = process.env.GOOGLE_VERTEX_PROJECT || process.env.GCP_PROJECT_ID || '';
const GOOGLE_VERTEX_LOCATION = process.env.GOOGLE_VERTEX_LOCATION || process.env.GCP_LOCATION || 'us-central1';
const DB_CONNECT_MAX_RETRIES = Number(process.env.DB_CONNECT_MAX_RETRIES || '4');
const DB_CONNECT_RETRY_BASE_MS = Number(process.env.DB_CONNECT_RETRY_BASE_MS || '750');
const INGEST_MODEL_TIMEOUT_MS = Number(process.env.INGEST_MODEL_TIMEOUT_MS || '180000');
const VALIDATION_MODEL_TIMEOUT_MS = Number(process.env.VALIDATION_MODEL_TIMEOUT_MS || '180000');

const INGESTED_DIR = './data/ingested';
// Keep sections small enough that Claude's extraction output fits within max_tokens (32768).
// Each claim is ~150 tokens of JSON. At 10 claims/1k input tokens:
//   5_000 tokens input → ~50 claims → ~7_500 tokens output → fits in 32768 limit with safety margin.
const MAX_TOKENS_PER_SECTION = 5_000;
const BOOK_MAX_TOKENS_PER_SECTION = Number(process.env.BOOK_MAX_TOKENS_PER_SECTION || '3_000');

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
	claudeInputTokens: number;
	claudeOutputTokens: number;
	vertexChars: number; // Vertex AI text-embedding-005 is character-based
	geminiTokens: number;
}

const costs: CostTracker = {
	claudeInputTokens: 0,
	claudeOutputTokens: 0,
	vertexChars: 0,
	geminiTokens: 0
};

function estimateCost(): string {
	// Claude Sonnet 4.5: $3/1M input, $15/1M output
	const claudeInput = (costs.claudeInputTokens / 1_000_000) * 3;
	const claudeOutput = (costs.claudeOutputTokens / 1_000_000) * 15;
	// Vertex AI text-embedding-005: $0.025/1M characters
	const vertex = (costs.vertexChars / 1_000_000) * 0.025;
	// Gemini 2.0 Flash: $0.075/1M input, $0.30/1M output (estimate 50/50)
	const gemini = (costs.geminiTokens / 1_000_000) * 0.19;

	const total = claudeInput + claudeOutput + vertex + gemini;
	// Convert to GBP (rough rate)
	const gbp = total * 0.79;
	return gbp.toFixed(4);
}

function estimateCostUsd(): string {
	const claudeInput = (costs.claudeInputTokens / 1_000_000) * 3;
	const claudeOutput = (costs.claudeOutputTokens / 1_000_000) * 15;
	const vertex = (costs.vertexChars / 1_000_000) * 0.025;
	const gemini = (costs.geminiTokens / 1_000_000) * 0.19;
	return (claudeInput + claudeOutput + vertex + gemini).toFixed(4);
}

function logExtractionCost(label: string, provider: IngestProvider) {
	if (provider === 'anthropic') {
		console.log(
			`  [COST] ${label}: Claude tokens — input: ${costs.claudeInputTokens.toLocaleString()}, output: ${costs.claudeOutputTokens.toLocaleString()} (running total: $${estimateCostUsd()})`
		);
		return;
	}
	console.log(
		`  [COST] ${label}: Gemini tokens — ${costs.geminiTokens.toLocaleString()} (running total: $${estimateCostUsd()})`
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
			await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
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

async function dbQueryWithRetry<T>(
	db: Surreal,
	query: string,
	vars?: Record<string, unknown>,
	maxAttempts = 3
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await db.query<T>(query, vars);
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

type IngestProvider = 'vertex' | 'anthropic';

function parseIngestProvider(value: string | undefined): IngestProvider {
	if (!value) return 'vertex';
	const normalized = value.toLowerCase().trim();
	return normalized === 'anthropic' ? 'anthropic' : 'vertex';
}

function getProviderLabel(provider: IngestProvider): string {
	return provider === 'anthropic' ? 'Claude' : 'Vertex Gemini';
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

/**
 * Call extraction model with retry and exponential backoff
 */
async function callClaude(
	provider: IngestProvider,
	client: Anthropic | null,
	vertex: ReturnType<typeof createVertex> | null,
	systemPrompt: string,
	userMessage: string,
	maxRetries = 3
): Promise<string> {
	let lastError: Error | null = null;

	const modelList = provider === 'anthropic' ? CLAUDE_MODELS : INGEST_VERTEX_MODELS;
	const providerLabel = getProviderLabel(provider);

	for (let modelIndex = 0; modelIndex < modelList.length; modelIndex++) {
		const model = modelList[modelIndex];
		if (modelIndex > 0) {
			console.log(`  [MODEL] Falling back to ${providerLabel} model: ${model}`);
		}

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				if (attempt > 0) {
					const delayMs = 1000 * Math.pow(2, attempt - 1);
					console.log(`  [RETRY] Attempt ${attempt + 1}/${maxRetries + 1} (waiting ${delayMs}ms)...`);
					await sleep(delayMs);
				}

				if (provider === 'anthropic') {
					if (!client) throw new Error('Anthropic client unavailable');

					const response = await withTimeout(
						client.messages.create({
							model,
							max_tokens: 32768,
							system: systemPrompt,
							messages: [{ role: 'user', content: userMessage }]
						}),
						INGEST_MODEL_TIMEOUT_MS,
						`${providerLabel} call (${model})`
					);

					if (response.usage) {
						costs.claudeInputTokens += response.usage.input_tokens;
						costs.claudeOutputTokens += response.usage.output_tokens;
					}

					// Detect truncated output before it causes a JSON parse failure downstream
					if (response.stop_reason === 'max_tokens') {
						throw new Error(
							'Model output was truncated (max_tokens reached) — reduce section size or increase max_tokens'
						);
					}

					const textBlock = response.content.find((block) => block.type === 'text');
					if (!textBlock || textBlock.type !== 'text') {
						throw new Error('No text block in model response');
					}

					return textBlock.text;
				}

				if (!vertex) throw new Error('Vertex client unavailable');
				const { text, usage } = await withTimeout(
					generateText({
						model: vertex(model),
						system: systemPrompt,
						messages: [{ role: 'user', content: userMessage }],
						temperature: 0.1
					}),
					INGEST_MODEL_TIMEOUT_MS,
					`${providerLabel} call (${model})`
				);

				if (usage) {
					costs.geminiTokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
				}

				return text;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (isModelUnavailableError(lastError)) {
					break;
				}

				const isRetryable =
					lastError.message.includes('429') ||
					lastError.message.includes('529') ||
					lastError.message.includes('500') ||
					lastError.message.includes('overloaded') ||
				lastError.message.includes('timeout') ||
				lastError.message.includes('prompt_too_long') ||
				lastError.message.includes('context_length');
				console.warn(`  [WARN] ${providerLabel} API error: ${lastError.message}`);
			}
		}
	}

	throw new Error(
		`${providerLabel} API failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`
	);
}

/**
 * Wrapper around callClaude that shows a spinner while waiting
 */
async function callClaudeWithProgress(
	provider: IngestProvider,
	client: Anthropic | null,
	vertex: ReturnType<typeof createVertex> | null,
	systemPrompt: string,
	userMessage: string,
	label: string
): Promise<string> {
	const spinner = startSpinner(label);
	try {
		const result = await callClaude(provider, client, vertex, systemPrompt, userMessage);
		spinner.stop();
		return result;
	} catch (e) {
		spinner.stop();
		throw e;
	}
}

/**
 * Attempt to fix malformed JSON by asking Claude
 */
async function fixJsonWithClaude(
	provider: IngestProvider,
	client: Anthropic | null,
	vertex: ReturnType<typeof createVertex> | null,
	originalJson: string,
	parseError: string,
	schema: string
): Promise<string> {
	console.log(`  [FIX] Asking ${getProviderLabel(provider)} to fix malformed JSON...`);

	const fixPrompt = `The following JSON output was malformed. Please fix it so it is valid JSON matching this schema:

Schema: ${schema}

Error: ${parseError}

Malformed JSON:
${originalJson}

Respond ONLY with the corrected JSON array. No explanation, no markdown backticks.`;

	return callClaudeWithProgress(
		provider,
		client,
		vertex,
		'You are a JSON repair assistant. Fix the malformed JSON to be valid. Respond with only the corrected JSON.',
		fixPrompt,
		`Fixing malformed JSON via ${getProviderLabel(provider)}`
	);
}

// ─── Source Metadata ───────────────────────────────────────────────────────
interface SourceMeta {
	title: string;
	author: string[];
	year?: number;
	source_type: string;
	url: string;
	fetched_at: string;
	word_count: number;
	char_count: number;
	estimated_tokens: number;
}

// ─── Partial Results (for crash recovery) ──────────────────────────────────
interface PartialResults {
	source: SourceMeta;
	claims?: ExtractionOutput;
	relations?: RelationsOutput;
	arguments?: GroupingOutput;
	embeddings?: number[][];
	validation?: ValidationOutput | null;
	stage_completed: string;
	// Mid-extraction checkpoint: if extraction crashes mid-section, resume from here
	extraction_progress?: {
		claims_so_far: ExtractionOutput;
		remaining_sections: string[];
	};
}

function savePartialResults(slug: string, results: PartialResults) {
	if (!fs.existsSync(INGESTED_DIR)) {
		fs.mkdirSync(INGESTED_DIR, { recursive: true });
	}
	const partialPath = path.join(INGESTED_DIR, `${slug}-partial.json`);
	const tmpPath = `${partialPath}.tmp`;
	// Write to temp file first, then atomic rename — prevents corruption on crash mid-write
	fs.writeFileSync(tmpPath, JSON.stringify(results, null, 2), 'utf-8');
	fs.renameSync(tmpPath, partialPath);
	console.log(`  [SAVE] Partial results saved to: ${partialPath}`);
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

async function getIngestionLog(db: Surreal, sourceUrl: string): Promise<IngestionLogRecord | null> {
	const result = await db.query<IngestionLogRecord[][]>(
		`SELECT * FROM ingestion_log WHERE source_url = $url LIMIT 1`,
		{ url: sourceUrl }
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	return rows.length > 0 ? rows[0] : null;
}

async function createIngestionLog(db: Surreal, sourceUrl: string, sourceTitle: string): Promise<void> {
	await db.query(
		`CREATE ingestion_log CONTENT {
			source_url: $url,
			source_title: $title,
			status: 'extracting',
			started_at: time::now()
		}`,
		{ url: sourceUrl, title: sourceTitle }
	);
}

async function updateIngestionLog(
	db: Surreal,
	sourceUrl: string,
	updates: Record<string, unknown>
): Promise<void> {
	if (Object.keys(updates).length === 0) return;

	const setClauses = Object.keys(updates)
		.map((key) => `${key} = $${key}`)
		.join(', ');
	const sql = `UPDATE ingestion_log SET ${setClauses} WHERE source_url = $url`;
	const vars = { ...updates, url: sourceUrl };
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
	// Pipeline mode: exit after stages 1-4 so the batch can start the next source's
	// Claude extraction while Gemini validation runs for this source in a separate process.
	const stopAfterEmbedding = args.includes('--stop-after-embedding');
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
		console.error('  --ingest-provider <p>   Extraction provider: vertex | anthropic (default: vertex)');
		console.error('  --force-stage <stage>   Re-run from this stage onwards, ignoring saved progress');
		console.error(`                          Valid stages: ${STAGES_ORDER.join(', ')}`);
		console.error('\nResume is automatic — re-run the same source to pick up where it left off.');
		process.exit(1);
	}

	// Validate environment
	if (ingestProvider === 'anthropic' && !ANTHROPIC_API_KEY) {
		console.error('[ERROR] INGEST_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
		process.exit(1);
	}
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

	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║              SOPHIA — INGESTION PIPELINE                    ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log('');
	console.log(`Source: "${sourceMeta.title}"`);
	console.log(`Author: ${sourceMeta.author.join(', ') || 'Unknown'}`);
	console.log(`Type:   ${sourceMeta.source_type}`);
	console.log(`Words:  ${sourceMeta.word_count.toLocaleString()}`);
	console.log(`Est. tokens: ~${estimateTokens(sourceText).toLocaleString()}`);
	console.log(`Ingest provider: ${ingestProvider}`);
	console.log(`Validate: ${shouldValidate ? 'YES (Gemini)' : 'No'}`);
	if (resumeFromStage) {
		console.log(`Resume from: ${resumeFromStage}`);
	}
	console.log('');

	// Initialize model clients
	const claude = ingestProvider === 'anthropic' ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
	const vertexIngestClient = createVertex({ project: GOOGLE_VERTEX_PROJECT, location: GOOGLE_VERTEX_LOCATION });

	try {
		// ═══════════════════════════════════════════════════════════════
		// STAGE 1: CLAIM EXTRACTION
		// ═══════════════════════════════════════════════════════════════
		let allClaims: ExtractionOutput = [];

		if (shouldRunStage('extracting', resumeFromStage)) {
			await updateIngestionLog(db, sourceMeta.url, { status: 'extracting' });

			console.log('┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 1: CLAIM EXTRACTION                               │');
			console.log('└──────────────────────────────────────────────────────────┘');
			const stageTimer1 = startStageTimer();
			const estimatedTokenCount = estimateTokens(sourceText);
			const sectionTokenLimit = getSectionTokenLimit(sourceMeta.source_type);

			if (estimatedTokenCount > sectionTokenLimit) {
				// Large source — split into sections
				console.log(
					`  [INFO] Source exceeds ${sectionTokenLimit.toLocaleString()} token estimate. Splitting into sections...`
				);
				const sections = splitIntoSections(sourceText, sectionTokenLimit);
				console.log(`  [INFO] Split into ${sections.length} sections`);

				// Check for mid-extraction resume — never re-send already-processed sections
				let sectionQueue: string[] = [...sections];
				let sectionLabel = 0;

				if (partial.extraction_progress?.claims_so_far.length > 0) {
					console.log(
						`  [RESUME] Mid-extraction checkpoint — ${partial.extraction_progress.claims_so_far.length} claims already extracted`
					);
					console.log(`  [RESUME] Skipping ${sections.length - partial.extraction_progress.remaining_sections.length} completed sections`);
					allClaims = partial.extraction_progress.claims_so_far;
					sectionQueue = partial.extraction_progress.remaining_sections;
					sectionLabel = sections.length - sectionQueue.length;
					if (sectionQueue.length === 0) {
						console.log(`  [RESUME] All ${sections.length} sections already extracted; skipping to stage completion`);
					}
				}

				for (let i = 0; i < sectionQueue.length; i++) {
					const section = sectionQueue[i];
					sectionLabel++;
					console.log(`\n  [SECTION ${sectionLabel}] (~${estimateTokens(section).toLocaleString()} tokens)`);

					const userMsg = EXTRACTION_USER(
						`${sourceMeta.title} (Section ${sectionLabel})`,
						sourceMeta.author.join(', ') || 'Unknown',
						section
					);

					let rawResponse: string;
					try {
						rawResponse = await callClaudeWithProgress(
							ingestProvider,
							claude,
							vertexIngestClient,
							EXTRACTION_SYSTEM,
							userMsg,
							`Extracting section ${sectionLabel} via ${getProviderLabel(ingestProvider)}`
						);
					} catch (apiError) {
						const apiMsg = apiError instanceof Error ? apiError.message : String(apiError);
						if (apiMsg.includes('truncated (max_tokens reached)') && section.length > 500) {
							// Section too dense — halve it and re-queue both halves
							const mid = Math.floor(section.length / 2);
							console.warn(
								`  [SPLIT] Section ${sectionLabel} truncated — splitting into 2 sub-sections and retrying`
							);
							sectionQueue.splice(i + 1, 0, section.substring(0, mid), section.substring(mid));
							sectionLabel--;
							continue;
						}
						throw apiError;
					}
					logExtractionCost('Extraction', ingestProvider);

					try {
						const parsed = parseJsonResponse(rawResponse);
						const validated = ExtractionOutputSchema.parse(
							normalizeExtractionPayload(parsed, domainOverride)
						);

						// Offset positions for later sections
						const offset = allClaims.length;
						const offsetClaims = validated.map((c) => ({
							...c,
							position_in_source: c.position_in_source + offset
						}));

						allClaims.push(...offsetClaims);
						console.log(`  [OK] Extracted ${validated.length} claims from section ${sectionLabel}`);

						// Checkpoint after each successful section
						partial.extraction_progress = {
							claims_so_far: [...allClaims],
							remaining_sections: sectionQueue.slice(i + 1)
						};
						savePartialResults(slug, partial);
					} catch (parseError) {
						console.warn(`  [WARN] JSON parse/validation failed for section ${sectionLabel}. Attempting fix...`);

						let fixedResponse: string;
						try {
							fixedResponse = await fixJsonWithClaude(
								ingestProvider,
								claude,
								vertexIngestClient,
								rawResponse,
								parseError instanceof Error ? parseError.message : String(parseError),
								'Array of { text, claim_type, domain, section_context, position_in_source, confidence }'
							);
						} catch (fixError) {
							const fixMsg = fixError instanceof Error ? fixError.message : String(fixError);
							if (fixMsg.includes('truncated (max_tokens reached)') && section.length > 500) {
								const mid = Math.floor(section.length / 2);
								console.warn(
									`  [SPLIT] Section ${sectionLabel} fix response truncated—splitting into 2 sub-sections and retrying`
								);
								sectionQueue.splice(i + 1, 0, section.substring(0, mid), section.substring(mid));
								sectionLabel--;
								continue;
							}
							throw fixError;
						}

						const fixedParsed = parseJsonResponse(fixedResponse);
						const fixedValidated = ExtractionOutputSchema.parse(
							normalizeExtractionPayload(fixedParsed, domainOverride)
						);
						const fixOffset = allClaims.length;
						const fixOffsetClaims = fixedValidated.map((c) => ({
							...c,
							position_in_source: c.position_in_source + fixOffset
						}));
						allClaims.push(...fixOffsetClaims);
						console.log(`  [OK] Fixed and extracted ${fixedValidated.length} claims from section ${sectionLabel}`);

						// Checkpoint after fix path
						partial.extraction_progress = {
							claims_so_far: [...allClaims],
							remaining_sections: sectionQueue.slice(i + 1)
						};
						savePartialResults(slug, partial);
					}
				}
			} else {
				// Normal-sized source — process in one pass
				const userMsg = EXTRACTION_USER(
					sourceMeta.title,
					sourceMeta.author.join(', ') || 'Unknown',
					sourceText
				);

				const rawResponse = await callClaude(
					ingestProvider,
					claude,
					vertexIngestClient,
					EXTRACTION_SYSTEM,
					userMsg
				);
				logExtractionCost('Extraction', ingestProvider);

				try {
					const parsed = parseJsonResponse(rawResponse);
					allClaims = ExtractionOutputSchema.parse(
						normalizeExtractionPayload(parsed, domainOverride)
					);
					console.log(`  [OK] Extracted ${allClaims.length} claims`);
				} catch (parseError) {
					console.warn('  [WARN] JSON parse/validation failed. Attempting fix...');

					const fixedResponse = await fixJsonWithClaude(
						ingestProvider,
						claude,
						vertexIngestClient,
						rawResponse,
						parseError instanceof Error ? parseError.message : String(parseError),
						'Array of { text, claim_type, domain, section_context, position_in_source, confidence }'
					);

					const fixedParsed = parseJsonResponse(fixedResponse);
					allClaims = ExtractionOutputSchema.parse(
						normalizeExtractionPayload(fixedParsed, domainOverride)
					);
					console.log(`  [OK] Fixed and extracted ${allClaims.length} claims`);
				}
			}

			// Print breakdown
			const claimTypeBreakdown: Record<string, number> = {};
			for (const claim of allClaims) {
				claimTypeBreakdown[claim.claim_type] = (claimTypeBreakdown[claim.claim_type] || 0) + 1;
			}
			console.log(`\n  Claims by type:`);
			for (const [type, count] of Object.entries(claimTypeBreakdown).sort((a, b) => b[1] - a[1])) {
				console.log(`    ${type}: ${count}`);
			}

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
			allClaims = partial.claims;
		}

		// ── Post-stage 1 check: fail fast if nothing was extracted ─────
		if (allClaims.length === 0) {
			throw new Error(
				'Stage 1 produced 0 claims — check extraction prompt or source quality before proceeding'
			);
		}

		// ═══════════════════════════════════════════════════════════════
		// STAGE 2: RELATION EXTRACTION
		// ═══════════════════════════════════════════════════════════════
		let relations: RelationsOutput = [];

		if (shouldRunStage('relating', resumeFromStage)) {
			await updateIngestionLog(db, sourceMeta.url, { status: 'relating' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 2: RELATION EXTRACTION                            │');
			console.log('└──────────────────────────────────────────────────────────┘');

			const claimsJson = JSON.stringify(allClaims, null, 2);
			const relUserMsg = RELATIONS_USER(claimsJson);
			const relRawResponse = await callClaude(
				ingestProvider,
				claude,
				vertexIngestClient,
				RELATIONS_SYSTEM,
				relUserMsg
			);
			logExtractionCost('Relations', ingestProvider);

			try {
				const parsed = parseJsonResponse(relRawResponse);
				relations = RelationsOutputSchema.parse(parsed);
				console.log(`  [OK] Identified ${relations.length} relations`);
			} catch (parseError) {
				console.warn('  [WARN] JSON parse/validation failed. Attempting fix...');
				const fixedResponse = await fixJsonWithClaude(
					ingestProvider,
					claude,
					vertexIngestClient,
					relRawResponse,
					parseError instanceof Error ? parseError.message : String(parseError),
					'Array of { from_position, to_position, relation_type, strength, note? }'
				);
				const fixedParsed = parseJsonResponse(fixedResponse);
				relations = RelationsOutputSchema.parse(fixedParsed);
				console.log(`  [OK] Fixed and identified ${relations.length} relations`);
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

			partial.relations = relations;
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

		// ═══════════════════════════════════════════════════════════════
		// STAGE 3: ARGUMENT GROUPING
		// ═══════════════════════════════════════════════════════════════
		let arguments_: GroupingOutput = [];

		if (shouldRunStage('grouping', resumeFromStage)) {
			await updateIngestionLog(db, sourceMeta.url, { status: 'grouping' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 3: ARGUMENT GROUPING                              │');
			console.log('└──────────────────────────────────────────────────────────┘');

			{
				const claimsJson = JSON.stringify(allClaims, null, 2);
				const relationsJson = JSON.stringify(relations, null, 2);
				const grpUserMsg = GROUPING_USER(claimsJson, relationsJson);
				const grpRawResponse = await callClaude(
					ingestProvider,
					claude,
					vertexIngestClient,
					GROUPING_SYSTEM,
					grpUserMsg
				);
				logExtractionCost('Grouping', ingestProvider);

				try {
					const parsed = parseJsonResponse(grpRawResponse);
					arguments_ = GroupingOutputSchema.parse(normalizeGroupingPayload(parsed));
					console.log(`  [OK] Identified ${arguments_.length} arguments`);
				} catch (parseError) {
					console.warn('  [WARN] JSON parse/validation failed. Attempting fix...');
					const fixedResponse = await fixJsonWithClaude(
						ingestProvider,
						claude,
						vertexIngestClient,
						grpRawResponse,
						parseError instanceof Error ? parseError.message : String(parseError),
						'Array of { name, tradition?, domain, summary, claims: [{ position_in_source, role }] }'
					);
					const fixedParsed = parseJsonResponse(fixedResponse);
					arguments_ = GroupingOutputSchema.parse(normalizeGroupingPayload(fixedParsed));
					console.log(`  [OK] Fixed and identified ${arguments_.length} arguments`);
				}
			}

			console.log(`\n  Named arguments:`);
			for (const arg of arguments_) {
				console.log(`    • ${arg.name} (${arg.domain}, ${arg.claims.length} claims)`);
			}

			partial.arguments = arguments_;
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

		// ═══════════════════════════════════════════════════════════════
		// STAGE 4: EMBEDDING
		// ═══════════════════════════════════════════════════════════════
		let allEmbeddings: number[][] = [];

		if (shouldRunStage('embedding', resumeFromStage)) {
			await updateIngestionLog(db, sourceMeta.url, { status: 'embedding' });

			console.log('\n┌──────────────────────────────────────────────────────────┐');
			console.log('│ STAGE 4: EMBEDDING (Vertex AI text-embedding-005)        │');
			console.log('└──────────────────────────────────────────────────────────┘');

			const claimTexts = allClaims.map((c) => c.text);
			console.log(`  Embedding ${claimTexts.length} claims via Vertex AI (${EMBEDDING_DIMENSIONS}-dim)...`);

			allEmbeddings = await embedTexts(claimTexts);

			// Track cost: Vertex AI charges per character, not per token
			const totalChars = claimTexts.reduce((sum, t) => sum + t.length, 0);
			costs.vertexChars += totalChars;

			console.log(`  [OK] Generated ${allEmbeddings.length} embeddings (${EMBEDDING_DIMENSIONS} dimensions)`);
			console.log(`  [COST] Vertex chars: ${totalChars.toLocaleString()} (~$${((totalChars / 1_000_000) * 0.025).toFixed(4)})}`);

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
				console.log('│ STAGE 5: CROSS-MODEL VALIDATION (Gemini)                │');
				console.log('└──────────────────────────────────────────────────────────┘');

				const vertex = createVertex({ project: GOOGLE_VERTEX_PROJECT, location: GOOGLE_VERTEX_LOCATION });

				const validationPrompt =
					VALIDATION_SYSTEM +
					'\n\n' +
					VALIDATION_USER({
						sourceTitle: sourceMeta.title,
						sourceText: sourceText.substring(0, 100_000), // Truncate if massive
						claimsJson: JSON.stringify(allClaims, null, 2),
						relationsJson: JSON.stringify(relations, null, 2),
						argumentsJson: JSON.stringify(arguments_, null, 2)
					});

				let validationError: Error | null = null;

				for (const modelName of GEMINI_MODELS) {
					let validationAttempts = 0;
					const maxValidationRetries = 3;

					while (validationAttempts <= maxValidationRetries) {
						try {
							if (validationAttempts > 0) {
								const delay = 1000 * Math.pow(2, validationAttempts - 1);
								console.log(`  [RETRY] Attempt ${validationAttempts + 1} (waiting ${delay}ms)...`);
								await sleep(delay);
							}

							const { text: responseText, usage } = await withTimeout(
								generateText({
									model: vertex(modelName),
									messages: [{ role: 'user', content: validationPrompt }],
									temperature: 0.1
								}),
								VALIDATION_MODEL_TIMEOUT_MS,
								`Validation call (${modelName})`
							);
							costs.geminiTokens += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
							const parsed = parseJsonResponse(responseText);
							validationResult = ValidationOutputSchema.parse(parsed);
							if (modelName !== GEMINI_MODEL) {
								console.log(`  [MODEL] Gemini fallback selected: ${modelName}`);
							}
							break;
						} catch (error) {
							validationError = error instanceof Error ? error : new Error(String(error));
							validationAttempts++;

							if (isModelUnavailableError(validationError)) {
								break;
							}

							if (validationAttempts > maxValidationRetries) {
								break;
							}
						}
					}

					if (validationResult) {
						break;
					}
				}

				if (!validationResult && validationError) {
					console.warn('  [WARN] Validation failed after model fallbacks. Continuing without validation.');
					console.warn(`  Error: ${validationError.message}`);
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
			}

			partial.validation = validationResult;
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
				'supports', 'contradicts', 'depends_on', 'responds_to', 'refines', 'exemplifies'
			];
			const existingSources = await db.query<[{ id: string }[]]>(
				'SELECT id FROM source WHERE url = $url LIMIT 1',
				{ url: sourceMeta.url }
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

			// 6c. Create claim records with embeddings
			console.log(`  Creating ${allClaims.length} claim records...`);
			const claimIdMap: Map<number, string> = new Map(); // position_in_source → claim ID

			for (let i = 0; i < allClaims.length; i++) {
				// Re-check DB connection every 25 claims to catch session expiry early
				if (i > 0 && i % 25 === 0) {
					await ensureDbConnected(db);
				}

				const claim = allClaims[i];
				const embedding = allEmbeddings[i] || null;

				const result = await db.query<[{ id: string }[]]>(
					`CREATE claim CONTENT {
						text: $text,
						claim_type: $claim_type,
						domain: $domain,
						source: $source,
						section_context: $section_context,
						position_in_source: $position_in_source,
						confidence: $confidence,
						embedding: $embedding,
						validation_score: $validation_score
					}`,
					{
						text: claim.text,
						claim_type: claim.claim_type,
						domain: domainOverride ?? claim.domain,
						source: sourceId,
						section_context: claim.section_context ?? undefined,
						position_in_source: claim.position_in_source,
						confidence: claim.confidence,
						embedding: embedding,
						validation_score:
							validationResult?.claims?.find(
								(c) => c.position_in_source === claim.position_in_source
							)?.faithfulness_score ?? undefined
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

			// 6d. Create relation records
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
					const vars: Record<string, unknown> = {
						from: fromId,
						to: toId
					};

					switch (rel.relation_type) {
						case 'supports':
						case 'contradicts': {
							relQuery += rel.note
								? ` SET strength = $strength, note = $note`
								: ` SET strength = $strength`;
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
							relQuery += ` SET necessity = $necessity`;
							vars.necessity = necessityMap[rel.strength] || 'supporting';
							break;
						}
						case 'responds_to': {
							const responseMap: Record<string, string> = {
								strong: 'direct_rebuttal',
								moderate: 'undermining',
								weak: 'concession'
							};
							relQuery += ` SET response_type = $response_type`;
							vars.response_type = responseMap[rel.strength] || 'refinement';
							break;
						}
						case 'refines': {
							const refinementMap: Record<string, string> = {
								strong: 'strengthens',
								moderate: 'qualifies',
								weak: 'clarifies'
							};
							relQuery += ` SET refinement_type = $refinement_type`;
							vars.refinement_type = refinementMap[rel.strength] || 'clarifies';
							break;
						}
						case 'exemplifies':
						default:
							break;
					}

					await db.query(relQuery, vars);
					relationsCreated++;
				} catch (error) {
					console.warn(
						`  [SKIP] Failed to create relation ${rel.relation_type}: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
			console.log(`  [OK] Created ${relationsCreated} relation records`);

			// 6e. Create argument records and part_of relations
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
			const storedArgs =
				Array.isArray(verifyArgResult?.[0]) ? (verifyArgResult[0][0]?.count ?? 0) : 0;

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
			`║  Claude tokens:    ${`${(costs.claudeInputTokens + costs.claudeOutputTokens).toLocaleString()} (in: ${costs.claudeInputTokens.toLocaleString()}, out: ${costs.claudeOutputTokens.toLocaleString()})`.padEnd(40)} ║`
		);
		console.log(
			`║  Vertex chars:     ${costs.vertexChars.toLocaleString().padEnd(40)} ║`
		);
		console.log(
			`║  Gemini tokens:    ${costs.geminiTokens.toLocaleString().padEnd(40)} ║`
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
