import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { mergeCatalogWithRestormelModels } from '$lib/ingestionModelCatalogMerge';
import { INGESTION_SOURCE_MODEL_HINTS } from '$lib/ingestionModelCatalog';
import { restormelListProjectModels } from '$lib/server/restormel';

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);

	let remote: unknown | null = null;
	let fetchError: string | null = null;
	try {
		remote = await restormelListProjectModels();
	} catch (e) {
		fetchError = e instanceof Error ? e.message : String(e);
	}

	const { entries, sync } = mergeCatalogWithRestormelModels(remote, fetchError);

	return json({
		entries,
		sourceHints: INGESTION_SOURCE_MODEL_HINTS,
		legend: {
			costTier: 'low = lower typical $/token; high = flagship / heaviest reasoning.',
			qualityTier:
				'capable = solid for routine extraction; strong = fewer mistakes; frontier = hardest documents.',
			speed: 'fast = quicker passes; thorough = deeper reasoning, often slower.',
			disclaimer:
				'Relative tiers for planning only. Actual routing and entitlements come from Restormel and your keys.',
			remoteModels:
				'When Restormel GET /projects/{id}/models succeeds, rows are merged with this static catalog; annotated rows keep Sophia copy, unknown models get heuristic tiers.'
		},
		catalogSync: sync
	});
};
