import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import {
	listSepTopicPresets,
	pickSepEntryUrlsForBatch
} from '$lib/server/sepEntryBatchPick';

/** List presets only (no catalog scan). */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		assertAdminAccess(locals);
		if (url.searchParams.get('presetsOnly') === '1') {
			return json({ presets: listSepTopicPresets() });
		}
		const presetId = url.searchParams.get('preset')?.trim() || null;
		const customKeywords = url.searchParams.get('keywords')?.trim() || null;
		const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get('limit') ?? '10', 10) || 10));
		const excludeIngested = url.searchParams.get('excludeIngested') !== '0';

		const result = await pickSepEntryUrlsForBatch({
			presetId,
			customKeywords,
			limit,
			excludeIngested
		});
		return json({
			...result,
			presets: listSepTopicPresets()
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to suggest URLs';
		return json({ error: message }, { status: 400 });
	}
};
