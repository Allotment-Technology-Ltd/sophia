export function isProviderQuotaExhaustedMessage(message: string): boolean {
	const m = message.toLowerCase();
	return (
		/\b402\b/.test(m) ||
		m.includes('payment required') ||
		m.includes('insufficient tokens') ||
		m.includes('purchase additional tokens') ||
		m.includes('insufficient credits') ||
		m.includes('billing quota') ||
		m.includes('account balance')
	);
}

export const isProviderCapacityExhaustedError = isProviderQuotaExhaustedMessage;

export function isRetryableIngestModelCallMessage(message: string): boolean {
	if (isProviderQuotaExhaustedMessage(message)) return false;
	return (
		message.includes('429') ||
		message.includes('529') ||
		message.includes('500') ||
		message.includes('502') ||
		message.includes('503') ||
		message.includes('504') ||
		message.includes('overloaded') ||
		message.includes('timeout') ||
		message.includes('aborted') ||
		message.includes('prompt_too_long') ||
		message.includes('context_length') ||
		/resource exhausted/i.test(message) ||
		/rate limit|too many requests/i.test(message) ||
		/\btpm\b|tokens per min|token.?per.?min/i.test(message)
	);
}

export function retryDelayMsForIngestModelCall(
	provider: string,
	message: string,
	attempt: number,
	env: NodeJS.ProcessEnv = process.env
): number {
	const baseDelayMs = 1000 * Math.pow(2, attempt - 1);
	const p = provider.trim().toLowerCase();
	if (p !== 'aizolo') return baseDelayMs;
	if (!/429|too many requests|rate limit|resource exhausted/i.test(message)) return baseDelayMs;
	const floorRaw = Number(env.INGEST_AIZOLO_RATE_LIMIT_BACKOFF_MS ?? '30000');
	const floor = Number.isFinite(floorRaw) && floorRaw > 0 ? floorRaw : 30000;
	const capRaw = Number(env.INGEST_AIZOLO_RATE_LIMIT_BACKOFF_MAX_MS ?? '180000');
	const cap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 180000;
	return Math.min(cap, Math.max(baseDelayMs, floor * attempt));
}

export function getIngestModelRetryPolicy(
	provider: string,
	message: string,
	env: NodeJS.ProcessEnv = process.env
): {
	retryable: boolean;
	capacityExhausted: boolean;
	backoffMs: (attempt: number) => number;
} {
	const capacityExhausted = isProviderQuotaExhaustedMessage(message);
	return {
		retryable: !capacityExhausted && isRetryableIngestModelCallMessage(message),
		capacityExhausted,
		backoffMs: (attempt: number) => retryDelayMsForIngestModelCall(provider, message, attempt, env)
	};
}
