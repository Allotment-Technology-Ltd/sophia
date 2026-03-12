/**
 * SOPHIA — Embeddings (Vertex AI)
 * 
 * Uses Google Vertex AI text-embedding-005 (768 dimensions)
 * Replaces Voyage AI for zero external vendor dependencies.
 * 
 * Authentication: Application Default Credentials (works automatically on Cloud Run)
 */

import { GoogleAuth } from 'google-auth-library';
import { loadServerEnv } from './env';

export const EMBEDDING_MODEL = 'text-embedding-005';
export const EMBEDDING_DIMENSIONS = 768; // text-embedding-005 native dimension
const EMBED_BATCH_SIZE = Number(process.env.VERTEX_EMBED_BATCH_SIZE || '250');
const EMBED_BATCH_DELAY_MS = Number(process.env.VERTEX_EMBED_BATCH_DELAY_MS || '250');
const EMBED_MAX_RETRIES = Number(process.env.VERTEX_EMBED_MAX_RETRIES || '6');
const EMBED_RETRY_BASE_MS = Number(process.env.VERTEX_EMBED_RETRY_BASE_MS || '1500');

function projectId(): string | undefined {
	loadServerEnv();
	return (
		process.env.GOOGLE_VERTEX_PROJECT ||
		process.env.GCP_PROJECT_ID ||
		process.env.GOOGLE_CLOUD_PROJECT ||
		process.env.GCLOUD_PROJECT ||
		process.env.VITE_FIREBASE_PROJECT_ID
	);
}

function location(): string {
	loadServerEnv();
	return process.env.GOOGLE_VERTEX_LOCATION || process.env.GCP_LOCATION || 'us-central1';
}

// Lazy auth client initialization
let authClient: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth {
	if (!authClient) {
		authClient = new GoogleAuth({
			scopes: ['https://www.googleapis.com/auth/cloud-platform']
		});
	}
	return authClient;
}

let totalTokensUsed = 0;

interface VertexEmbeddingRequest {
	instances: Array<{
		content: string;
		taskType?: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
	}>;
}

interface VertexEmbeddingResponse {
	predictions: Array<{
		embeddings: {
			values: number[];
		};
		statistics?: {
			token_count?: number;
		};
	}>;
}

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

/**
 * Call Vertex AI text-embedding-005 via REST API
 * Uses Application Default Credentials (automatic on Cloud Run)
 */
async function callVertexEmbedding(
	texts: string[],
	taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT'
): Promise<number[][]> {
	const PROJECT_ID = projectId();
	if (!PROJECT_ID) {
		throw new Error('Vertex AI project ID is required. Set GOOGLE_VERTEX_PROJECT or GCP_PROJECT_ID environment variable.');
	}
	const LOCATION = location();

	const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${EMBEDDING_MODEL}:predict`;

	const auth = getAuthClient();
	const client = await auth.getClient();
	const accessToken = await client.getAccessToken();

	if (!accessToken.token) {
		throw new Error('Failed to obtain access token for Vertex AI');
	}

	const requestBody: VertexEmbeddingRequest = {
		instances: texts.map(text => ({
			content: text,
			taskType
		}))
	};

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${accessToken.token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(requestBody)
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Vertex AI embedding failed: ${response.status} ${response.statusText} - ${errorText}`);
	}

	const data = await response.json() as VertexEmbeddingResponse;

	if (!data.predictions || data.predictions.length === 0) {
		throw new Error('No embeddings returned from Vertex AI');
	}

	// Extract embeddings and track tokens
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

	if (batchTokens > 0) {
		totalTokensUsed += batchTokens;
	}

	return embeddings;
}

/**
 * Embed a single text for document storage/indexing
 * Uses RETRIEVAL_DOCUMENT task type for better representation of semantic content
 */
export async function embedText(text: string): Promise<number[]> {
	try {
		console.log('[EMBED] Embedding document text...');

		const embeddings = await callVertexEmbedding([text], 'RETRIEVAL_DOCUMENT');

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

/**
 * Embed multiple texts in batches
 * Vertex AI supports up to 250 instances per request
 * Automatically chunks larger arrays
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
	const BATCH_SIZE = Math.max(1, EMBED_BATCH_SIZE);
	const embeddings: number[][] = [];

	try {
		console.log(`[EMBED] Embedding ${texts.length} texts in batches of ${BATCH_SIZE}...`);

		// Process in batches of up to 250
		for (let i = 0; i < texts.length; i += BATCH_SIZE) {
			const batch = texts.slice(i, i + BATCH_SIZE);
			const batchNum = Math.floor(i / BATCH_SIZE) + 1;
			console.log(`[EMBED] Batch ${batchNum}: embedding ${batch.length} texts`);

			let batchEmbeddings: number[][] | null = null;
			let lastError: unknown = null;
			for (let attempt = 1; attempt <= EMBED_MAX_RETRIES; attempt++) {
				try {
					batchEmbeddings = await callVertexEmbedding(batch, 'RETRIEVAL_DOCUMENT');
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
 * Embed a query for semantic search/retrieval
 * Uses RETRIEVAL_QUERY task type, optimised for finding relevant documents
 */
export async function embedQuery(text: string): Promise<number[]> {
	try {
		console.log('[EMBED] Embedding query...');

		const embeddings = await callVertexEmbedding([text], 'RETRIEVAL_QUERY');

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
	console.log('\n[EMBED] === SESSION STATISTICS ===');
	console.log(`Total tokens embedded: ${totalTokensUsed.toLocaleString()}`);
	console.log(`Estimated cost (Vertex AI): $${getEstimatedCost()}`);
	console.log(`Model: ${EMBEDDING_MODEL}`);
	console.log(`Dimensions: ${EMBEDDING_DIMENSIONS}`);
	console.log('');
}
