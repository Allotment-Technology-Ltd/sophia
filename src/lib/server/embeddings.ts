/**
 * SOPHIA — Embeddings (Provider-Abstracted)
 *
 * Supports multiple embedding providers behind a unified interface.
 * Provider selection: EMBEDDING_PROVIDER env var (default: 'vertex')
 *
 * Providers:
 * - vertex: Google Vertex AI text-embedding-005 (768-dim, GCP ADC auth)
 * - voyage: Voyage AI voyage-4 family (1024-dim, API key auth)
 *           Supports asymmetric retrieval: voyage-4-lite for documents,
 *           voyage-4-large for queries (shared embedding space)
 */

import { GoogleAuth } from 'google-auth-library';

import { loadServerEnv } from './env';

type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

interface EmbeddingProvider {
	readonly name: string;
	readonly dimensions: number;
	readonly documentModel: string;
	readonly queryModel: string;
	embed(texts: string[], taskType: EmbeddingTaskType, cachedToken?: string | null): Promise<number[][]>;
	acquireSessionToken?(): Promise<string | null>;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const EMBED_BATCH_SIZE = Number(process.env.VERTEX_EMBED_BATCH_SIZE || process.env.EMBED_BATCH_SIZE || '250');
const EMBED_BATCH_DELAY_MS = Number(process.env.VERTEX_EMBED_BATCH_DELAY_MS || process.env.EMBED_BATCH_DELAY_MS || '80');
const EMBED_MAX_RETRIES = Number(process.env.VERTEX_EMBED_MAX_RETRIES || process.env.EMBED_MAX_RETRIES || '6');
const EMBED_RETRY_BASE_MS = Number(process.env.VERTEX_EMBED_RETRY_BASE_MS || process.env.EMBED_RETRY_BASE_MS || '1500');

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableEmbeddingError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		message.includes('429') ||
		message.includes('resource_exhausted') ||
		message.includes('rate') ||
		message.includes('503') ||
		message.includes('502') ||
		message.includes('500') ||
		message.includes('temporarily unavailable') ||
		message.includes('timeout')
	);
}

// ─── Vertex AI Provider ─────────────────────────────────────────────────────

function createVertexProvider(): EmbeddingProvider {
	function projectId(): string | undefined {
		loadServerEnv();
		return (
			process.env.GOOGLE_VERTEX_PROJECT ||
			process.env.GCP_PROJECT_ID ||
			process.env.GOOGLE_CLOUD_PROJECT ||
			process.env.GCLOUD_PROJECT
		);
	}

	function location(): string {
		loadServerEnv();
		return process.env.GOOGLE_VERTEX_LOCATION || process.env.GCP_LOCATION || 'us-central1';
	}

	let authClient: InstanceType<typeof GoogleAuth> | null = null;

	function getAuthClient(): InstanceType<typeof GoogleAuth> {
		if (!authClient) {
			authClient = new GoogleAuth({
				scopes: ['https://www.googleapis.com/auth/cloud-platform']
			});
		}
		return authClient;
	}

	const model = 'text-embedding-005';

	return {
		name: 'vertex',
		dimensions: 768,
		documentModel: model,
		queryModel: model,

		async acquireSessionToken(): Promise<string | null> {
			const auth = getAuthClient();
			const client = await auth.getClient();
			const tokenResult = await client.getAccessToken();
			return tokenResult.token ?? null;
		},

		async embed(texts, taskType, cachedAccessToken): Promise<number[][]> {
			const PROJECT_ID = projectId();
			if (!PROJECT_ID) {
				throw new Error('Vertex AI project ID is required. Set GOOGLE_VERTEX_PROJECT or GCP_PROJECT_ID.');
			}
			const LOCATION = location();
			const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${model}:predict`;

			let token = cachedAccessToken?.trim() || null;
			if (!token) {
				token = await this.acquireSessionToken!();
			}
			if (!token) {
				throw new Error('Failed to obtain access token for Vertex AI');
			}

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					instances: texts.map(text => ({ content: text, taskType }))
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Vertex AI embedding failed: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const data = await response.json() as {
				predictions: Array<{
					embeddings: { values: number[] };
					statistics?: { token_count?: number };
				}>;
			};

			if (!data.predictions?.length) {
				throw new Error('No embeddings returned from Vertex AI');
			}

			const embeddings: number[][] = [];
			let batchTokens = 0;

			for (const prediction of data.predictions) {
				if (!prediction.embeddings?.values) {
					throw new Error('Invalid embedding format from Vertex AI');
				}
				embeddings.push(prediction.embeddings.values);
				if (prediction.statistics?.token_count) {
					batchTokens += prediction.statistics.token_count;
				}
			}

			if (batchTokens > 0) totalTokensUsed += batchTokens;
			return embeddings;
		}
	};
}

// ─── Voyage AI Provider ─────────────────────────────────────────────────────

function createVoyageProvider(): EmbeddingProvider {
	const docModel = process.env.VOYAGE_DOCUMENT_MODEL || 'voyage-4-lite';
	const qryModel = process.env.VOYAGE_QUERY_MODEL || 'voyage-4-large';

	function getApiKey(): string {
		loadServerEnv();
		const key = process.env.VOYAGE_API_KEY?.trim();
		if (!key) {
			throw new Error('VOYAGE_API_KEY is required for the Voyage embedding provider.');
		}
		return key;
	}

	return {
		name: 'voyage',
		dimensions: 1024,
		documentModel: docModel,
		queryModel: qryModel,

		async embed(texts, taskType): Promise<number[][]> {
			const apiKey = getApiKey();
			const model = taskType === 'RETRIEVAL_QUERY' ? qryModel : docModel;
			const inputType = taskType === 'RETRIEVAL_QUERY' ? 'query' : 'document';

			const response = await fetch('https://api.voyageai.com/v1/embeddings', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model,
					input: texts,
					input_type: inputType
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Voyage AI embedding failed: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const data = await response.json() as {
				data: Array<{ embedding: number[]; index: number }>;
				usage?: { total_tokens?: number };
			};

			if (!data.data?.length) {
				throw new Error('No embeddings returned from Voyage AI');
			}

			const sorted = [...data.data].sort((a, b) => a.index - b.index);
			const embeddings = sorted.map(d => d.embedding);

			if (data.usage?.total_tokens) {
				totalTokensUsed += data.usage.total_tokens;
			}

			return embeddings;
		}
	};
}

// ─── Provider Resolution ────────────────────────────────────────────────────

let activeProvider: EmbeddingProvider | null = null;

function resolveProvider(): EmbeddingProvider {
	if (activeProvider) return activeProvider;

	loadServerEnv();
	const providerName = (process.env.EMBEDDING_PROVIDER || 'vertex').toLowerCase().trim();

	switch (providerName) {
		case 'voyage':
			activeProvider = createVoyageProvider();
			break;
		case 'vertex':
		default:
			activeProvider = createVertexProvider();
			break;
	}

	console.log(`[EMBED] Provider: ${activeProvider.name} (${activeProvider.dimensions}-dim, doc=${activeProvider.documentModel}, query=${activeProvider.queryModel})`);
	return activeProvider;
}

export function getEmbeddingProvider(): EmbeddingProvider {
	return resolveProvider();
}

export function getEmbeddingModel(): string {
	return resolveProvider().documentModel;
}

export const EMBEDDING_MODEL = 'text-embedding-005';

export function getEmbeddingDimensions(): number {
	return resolveProvider().dimensions;
}

export const EMBEDDING_DIMENSIONS = 768;

let totalTokensUsed = 0;

/**
 * Embed a single text for document storage/indexing.
 * Uses RETRIEVAL_DOCUMENT task type for better representation of semantic content.
 */
export async function embedText(text: string): Promise<number[]> {
	try {
		const provider = resolveProvider();
		console.log(`[EMBED] Embedding document text via ${provider.name}...`);

		const embeddings = await provider.embed([text], 'RETRIEVAL_DOCUMENT');

		console.log(
			`[EMBED] Embedded 1 text (session total: ${totalTokensUsed} tokens)`
		);

		return embeddings[0];
	} catch (error) {
		console.error('[EMBED] Error embedding text:', error);
		throw new Error(
			`Failed to embed text: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export type EmbedTextsBatchProgress = {
	/** Start index in the `texts` array for this Vertex request */
	batchStartIndex: number;
	batchSize: number;
	/** Embeddings produced so far for this `embedTexts` call (same length as batchStartIndex + batchSize after each batch) */
	cumulativeEmbeddings: number[][];
};

/**
 * Embed multiple texts in batches.
 * Automatically chunks larger arrays and retries transient errors.
 */
export async function embedTexts(
	texts: string[],
	options?: {
		/** Called after each successful batch (for disk/Neon checkpoints). */
		onBatchComplete?: (progress: EmbedTextsBatchProgress) => void | Promise<void>;
	}
): Promise<number[][]> {
	const BATCH_SIZE = Math.max(1, EMBED_BATCH_SIZE);
	const embeddings: number[][] = [];
	const provider = resolveProvider();

	try {
		console.log(`[EMBED] Embedding ${texts.length} texts via ${provider.name} in batches of ${BATCH_SIZE}...`);

		let sessionToken: string | null = null;
		if (provider.acquireSessionToken) {
			sessionToken = await provider.acquireSessionToken();
			if (!sessionToken) {
				throw new Error(`Failed to obtain session token for ${provider.name}`);
			}
		}

		for (let i = 0; i < texts.length; i += BATCH_SIZE) {
			const batch = texts.slice(i, i + BATCH_SIZE);
			const batchNum = Math.floor(i / BATCH_SIZE) + 1;
			console.log(`[EMBED] Batch ${batchNum}: embedding ${batch.length} texts`);

			let batchEmbeddings: number[][] | null = null;
			let lastError: unknown = null;
			for (let attempt = 1; attempt <= EMBED_MAX_RETRIES; attempt++) {
				try {
					batchEmbeddings = await provider.embed(batch, 'RETRIEVAL_DOCUMENT', sessionToken);
					break;
				} catch (error) {
					lastError = error;
					if (attempt >= EMBED_MAX_RETRIES || !isRetryableEmbeddingError(error)) {
						throw error;
					}
					const waitMs = EMBED_RETRY_BASE_MS * Math.pow(2, attempt - 1);
					console.warn(
						`[EMBED] Batch ${batchNum} retry ${attempt}/${EMBED_MAX_RETRIES} after ${waitMs}ms: ${
							error instanceof Error ? error.message : String(error)
						}`
					);
					await sleep(waitMs);
				}
			}
			if (!batchEmbeddings) {
				throw new Error(
					`Embedding batch ${batchNum} failed after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`
				);
			}

			embeddings.push(...batchEmbeddings);

			console.log(
				`[EMBED] Batch ${batchNum} complete (session total: ${totalTokensUsed} tokens)`
			);

			if (options?.onBatchComplete) {
				await options.onBatchComplete({
					batchStartIndex: i,
					batchSize: batch.length,
					cumulativeEmbeddings: embeddings
				});
			}

			if (EMBED_BATCH_DELAY_MS > 0 && i + BATCH_SIZE < texts.length) {
				await sleep(EMBED_BATCH_DELAY_MS);
			}
		}

		if (embeddings.length !== texts.length) {
			throw new Error(
				`Embedding count mismatch: got ${embeddings.length} embeddings for ${texts.length} texts`
			);
		}

		return embeddings;
	} catch (error) {
		console.error('[EMBED] Error embedding texts:', error);
		throw new Error(
			`Failed to embed texts: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Embed a query for semantic search/retrieval.
 * Uses RETRIEVAL_QUERY task type, optimised for finding relevant documents.
 * With the Voyage provider, this uses voyage-4-large for SOTA retrieval quality.
 */
export async function embedQuery(text: string): Promise<number[]> {
	try {
		const provider = resolveProvider();
		console.log(`[EMBED] Embedding query via ${provider.name} (${provider.queryModel})...`);

		const embeddings = await provider.embed([text], 'RETRIEVAL_QUERY');

		console.log(
			`[EMBED] Query embedded (session total: ${totalTokensUsed} tokens)`
		);

		return embeddings[0];
	} catch (error) {
		console.error('[EMBED] Error embedding query:', error);
		throw new Error(
			`Failed to embed query: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Get total tokens used in this session
 * Useful for tracking costs
 */
export function getTotalTokensUsed(): number {
	return totalTokensUsed;
}

/**
 * Get estimated cost of embeddings used so far
 * Based on Vertex AI text-embedding-005 pricing: ~$0.025 per 1M characters
 * (Vertex pricing is character-based, not token-based, but we track tokens for compatibility)
 */
export function getEstimatedCost(): string {
	// Rough approximation: 1 token ≈ 4 characters
	const estimatedChars = totalTokensUsed * 4;
	const costPer1MChars = 0.025;
	const cost = (estimatedChars / 1_000_000) * costPer1MChars;
	return cost.toFixed(6);
}

/**
 * Reset token counter for a new session
 */
export function resetTokenCounter(): void {
	const previousTotal = totalTokensUsed;
	totalTokensUsed = 0;
	console.log(
		`[EMBED] Token counter reset (was ${previousTotal}, roughly $${getEstimatedCost()} cost)`
	);
}

/**
 * Log session statistics
 */
export function logStats(): void {
	const provider = resolveProvider();
	console.log('\n[EMBED] === SESSION STATISTICS ===');
	console.log(`Provider: ${provider.name}`);
	console.log(`Total tokens embedded: ${totalTokensUsed.toLocaleString()}`);
	console.log(`Estimated cost: $${getEstimatedCost()}`);
	console.log(`Document model: ${provider.documentModel}`);
	console.log(`Query model: ${provider.queryModel}`);
	console.log(`Dimensions: ${provider.dimensions}`);
	console.log('');
}
