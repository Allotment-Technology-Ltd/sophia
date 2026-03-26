/**
 * Shared classification for model ids (ingestion surfaces, allowed-models, admin).
 */

export function isEmbeddingModelByProviderAndId(provider: string, modelId: string): boolean {
	const p = provider.trim().toLowerCase();
	if (p === 'voyage') return true;
	if (/embedding|embed|vector|textembedding|gecko|e5-|bge-/i.test(modelId)) return true;
	return false;
}
