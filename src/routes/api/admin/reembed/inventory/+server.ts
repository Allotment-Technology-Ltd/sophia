import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getEmbeddingDimensions } from '$lib/server/embeddings';
import { getReembedCorpusInventory } from '$lib/server/ingestion/reembedCorpusInventory';

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);
	const targetDim = getEmbeddingDimensions();
	const inventory = await getReembedCorpusInventory(targetDim);
	return json({
		ok: true,
		runtimeExpectedDim: targetDim,
		inventory
	});
};
