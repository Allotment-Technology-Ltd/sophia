import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '$env/dynamic/private';

export const VALIDATION_MODEL = 'gemini-2.0-flash';
const VALIDATION_MODELS = parseModelList(process.env.GEMINI_MODELS, [
	VALIDATION_MODEL,
	'gemini-2.0-flash',
	'gemini-2.0-flash-exp',
	'gemini-1.5-flash'
]);

const geminiApiKey = env.GOOGLE_AI_API_KEY;
const client = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

let totalTokensUsed = 0;

interface RetryOptions {
	maxRetries: number;
	initialDelay: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
	maxRetries: 3,
	initialDelay: 1000 // 1 second
};

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/**
 * Call Gemini API with exponential backoff retry
 */
async function callWithRetry(
	prompt: string,
	options: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<string> {
	if (!client) {
		throw new Error('GOOGLE_AI_API_KEY is not configured');
	}

	let lastError: Error | null = null;

	for (const modelName of VALIDATION_MODELS) {
		for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
			try {
				console.log(
					`[GEMINI] Validation request (model: ${modelName}, attempt ${attempt + 1}/${options.maxRetries + 1})`
				);

				const model = client.getGenerativeModel({ model: modelName });
				const result = await model.generateContent({
					contents: [
						{
							role: 'user',
							parts: [{ text: prompt }]
						}
					],
					generationConfig: {
						temperature: 0.1
					}
				});

				const response = result.response;
				const text = response?.text() || '';

				if (response?.usageMetadata) {
					const tokensUsed = (response.usageMetadata.totalTokenCount || 0) -
						(response.usageMetadata.cachedContentTokenCount || 0);
					totalTokensUsed += tokensUsed;
					console.log(
						`[GEMINI] Used ${tokensUsed} tokens (session total: ${totalTokensUsed})`
					);
				}

				return text;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (isModelUnavailableError(lastError)) {
					break;
				}

				const isRetryable =
					lastError.message.includes('429') ||
					lastError.message.includes('503') ||
					lastError.message.includes('500') ||
					lastError.message.includes('timeout');

				if (attempt < options.maxRetries && isRetryable) {
					const delayMs = options.initialDelay * Math.pow(2, attempt);
					console.warn(
						`[GEMINI] Attempt ${attempt + 1} failed. Retrying in ${delayMs}ms...`,
						lastError.message
					);
					await sleep(delayMs);
				} else if (attempt < options.maxRetries) {
					await sleep(options.initialDelay * Math.pow(2, attempt));
				}
			}
		}
	}

	// All retries exhausted
	console.error('[GEMINI] All retry attempts exhausted');
	throw new Error(
		`Failed to get validation from Gemini after ${options.maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`
	);
}

/**
 * Validate extracted claims/relations/arguments using Gemini
 * Uses adversarial evaluation for quality assurance
 */
export async function validateWithGemini(prompt: string): Promise<string> {
	try {
		return await callWithRetry(prompt);
	} catch (error) {
		console.error('[GEMINI] Validation failed:', error);
		throw new Error(
			`Gemini validation failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Get total tokens used in this session
 * Useful for tracking costs: Gemini 2.0 Flash = $0.075 per 1M input tokens, $0.30 per 1M output tokens
 */
export function getTotalTokensUsed(): number {
	return totalTokensUsed;
}

/**
 * Get estimated cost of validation used so far
 * Based on Gemini 2.0 Flash pricing (assuming ~2:1 output:input ratio for validation)
 */
export function getEstimatedValidationCost(): string {
	// Average assumption: validation output is ~2x input size
	const inputTokens = totalTokensUsed / 3;
	const outputTokens = (totalTokensUsed * 2) / 3;

	const inputCost = (inputTokens / 1_000_000) * 0.075;
	const outputCost = (outputTokens / 1_000_000) * 0.30;
	const totalCost = inputCost + outputCost;

	return totalCost.toFixed(6);
}

/**
 * Reset token counter for a new session
 */
export function resetTokenCounter(): void {
	const previousTotal = totalTokensUsed;
	totalTokensUsed = 0;
	console.log(
		`[GEMINI] Token counter reset (was ${previousTotal}, roughly $${getEstimatedValidationCost()} cost)`
	);
}

/**
 * Log session statistics
 */
export function logStats(): void {
	console.log('\n[GEMINI] === VALIDATION SESSION STATISTICS ===');
	console.log(`Total tokens used: ${totalTokensUsed.toLocaleString()}`);
	console.log(`Estimated cost (Gemini 2.0 Flash): $${getEstimatedValidationCost()}`);
	console.log(`Model: ${VALIDATION_MODEL}`);
	console.log('');
}
