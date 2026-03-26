/**
 * Product policy: do not surface xAI (Grok) as a first-class provider or model in Sophia pickers.
 * Unrelated providers (e.g. Groq Inc.) are not affected.
 */
export function isExcludedXaiGrokCatalogRef(providerType: string, modelId: string): boolean {
	const pt = providerType.trim().toLowerCase();
	const mid = modelId.trim().toLowerCase();
	if (pt === 'xai' || pt === 'x.ai') return true;
	if (mid.startsWith('grok-') || mid.includes('/grok')) return true;
	if (mid.startsWith('x-ai/') || mid.includes('x-ai/grok')) return true;
	return false;
}
