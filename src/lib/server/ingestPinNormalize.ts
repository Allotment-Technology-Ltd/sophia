/**
 * Normalizes admin / CLI pinned model ids so provider APIs accept them
 * (e.g. Anthropic dated Haiku id, retired Gemini 1.5 aliases).
 */
export function normalizeIngestPinModelId(provider: string, modelId: string): string {
	const p = provider.toLowerCase().trim();
	const m = modelId.trim();
	if ((p === 'vertex' || p === 'google') && m === 'gemini-1.5-pro') return 'gemini-2.5-pro';
	if ((p === 'vertex' || p === 'google') && m === 'gemini-1.5-flash') return 'gemini-2.5-flash';
	if (p === 'anthropic' && m === 'claude-3-5-haiku') return 'claude-3-5-haiku-20241022';
	return m;
}
