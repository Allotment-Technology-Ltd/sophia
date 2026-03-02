// ...existing code...
import { VoyageAIClient } from 'voyageai';
import { env } from '$env/dynamic/private';

export const EMBEDDING_MODEL = env.VOYAGE_MODEL || 'voyage-3-lite';
export const EMBEDDING_DIMENSIONS = Number(env.VOYAGE_DIMENSIONS || '1024');
const EMBEDDING_MODELS = parseModelList(env.VOYAGE_MODELS, [
	EMBEDDING_MODEL,
	'voyage-4',
	'voyage-3',
	'voyage-3-lite'
]);

const client = new VoyageAIClient({
	apiKey: env.VOYAGE_API_KEY
});

let totalTokensUsed = 0;

function parseModelList(envValue: string | undefined, defaults: string[]): string[] {
	const fromEnv = (envValue || '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);

	const unique: string[] = [];
	for (const model of [...fromEnv, ...defaults]) {
		if (!unique.includes(model)) unique.push(model);
	}
	return unique;
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

function getVoyageModelCandidates(requiredDimension: number): string[] {
	return EMBEDDING_MODELS.filter((model) => {
		if (requiredDimension >= 1024 && model === 'voyage-3-lite') return false;
		return true;
	});
}

async function embedWithFallback(input: string | string[], inputType: 'document' | 'query') {
	const candidates = getVoyageModelCandidates(EMBEDDING_DIMENSIONS);
	let lastError: Error | null = null;

	for (const model of candidates) {
		try {
			return await client.embed({
				model,
				input,
				inputType,
				outputDimension: EMBEDDING_DIMENSIONS
			});
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (!isModelUnavailableError(lastError)) {
				throw lastError;
			}
		}
	}

	throw new Error(`No available Voyage model could embed with ${EMBEDDING_DIMENSIONS} dimensions: ${lastError?.message || 'unknown error'}`);
}

/**
 * Embed a single text for document storage/indexing
 * Uses document input_type for better representation of semantic content
 */
export async function embedText(text: string): Promise<number[]> {
	try {
		console.log('[EMBED] Embedding document text...');

		const response = await embedWithFallback(text, 'document');

		// Track tokens for cost awareness
		if (response.usage?.totalTokens) {
			totalTokensUsed += response.usage.totalTokens;
			console.log(
				`[EMBED] Used ${response.usage.totalTokens} tokens (session total: ${totalTokensUsed})`
			);
		}

		// Voyage AI returns embeddings in data array
		if (response.data && response.data.length > 0 && response.data[0].embedding) {
			return response.data[0].embedding;
		}

		throw new Error('No embedding returned from Voyage AI');
	} catch (error) {
		console.error('[EMBED] Error embedding text:', error);
		throw new Error(
			`Failed to embed text: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Embed multiple texts in batches
 * Voyage API supports up to 128 documents per request
 * Automatically chunks larger arrays
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
	const BATCH_SIZE = 128;
	const embeddings: number[][] = [];

	try {
		console.log(`[EMBED] Embedding ${texts.length} texts in batches of ${BATCH_SIZE}...`);

		// Process in batches of up to 128
		for (let i = 0; i < texts.length; i += BATCH_SIZE) {
			const batch = texts.slice(i, i + BATCH_SIZE);
			const batchNum = Math.floor(i / BATCH_SIZE) + 1;
			console.log(`[EMBED] Batch ${batchNum}: embedding ${batch.length} texts`);

			const response = await embedWithFallback(batch, 'document');

			// Track tokens
			if (response.usage?.totalTokens) {
				totalTokensUsed += response.usage.totalTokens;
				console.log(
					`[EMBED] Batch ${batchNum} used ${response.usage.totalTokens} tokens (session total: ${totalTokensUsed})`
				);
			}

			// Extract embeddings in order
			if (response.data) {
				for (const item of response.data) {
					if (item.embedding) embeddings.push(item.embedding);
				}
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
 * Uses query input_type, optimised for finding relevant documents
 */
export async function embedQuery(text: string): Promise<number[]> {
	try {
		console.log('[EMBED] Embedding query...');

		const response = await embedWithFallback(text, 'query');

		// Track tokens for cost awareness
		if (response.usage?.totalTokens) {
			totalTokensUsed += response.usage.totalTokens;
			console.log(
				`[EMBED] Query used ${response.usage.totalTokens} tokens (session total: ${totalTokensUsed})`
			);
		}

		if (response.data && response.data.length > 0 && response.data[0].embedding) {
			return response.data[0].embedding;
		}

		throw new Error('No embedding returned from Voyage AI');
	} catch (error) {
		console.error('[EMBED] Error embedding query:', error);
		throw new Error(
			`Failed to embed query: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Get total tokens used in this session
 * Useful for tracking costs: Voyage 3 Lite = $0.02 per 1M tokens
 */
export function getTotalTokensUsed(): number {
	return totalTokensUsed;
}

/**
 * Get estimated cost of embeddings used so far
 * Based on Voyage 3 Lite pricing: $0.02 per 1M tokens
 */
export function getEstimatedCost(): string {
	const costPer1M = 0.02;
	const cost = (totalTokensUsed / 1_000_000) * costPer1M;
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
	console.log(`Estimated cost (Voyage 3 Lite): $${getEstimatedCost()}`);
	console.log(`Model: ${EMBEDDING_MODEL}`);
	console.log(`Dimensions: ${EMBEDDING_DIMENSIONS}`);
	console.log('');
}
