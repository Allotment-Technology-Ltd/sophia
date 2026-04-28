import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getEmbeddingDimensions } from '$lib/server/embeddings';
import { getReembedCorpusInventory } from '$lib/server/ingestion/reembedCorpusInventory';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		assertAdminAccess(locals);
		const targetDim = getEmbeddingDimensions();
		const inventory = await getReembedCorpusInventory(targetDim);
		return json({
			ok: true,
			runtimeExpectedDim: targetDim,
			inventory
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Inventory failed';
		// Typically Surreal query failures/timeouts: present as degraded, not a hard 500.
		return json({ ok: false, error: message }, { status: 503 });
	}
};
