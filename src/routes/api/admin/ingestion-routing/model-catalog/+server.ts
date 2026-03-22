import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { buildRestormelProjectModelEntriesOnly } from '$lib/ingestionModelCatalogMerge';
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

	const { entries, sync } = buildRestormelProjectModelEntriesOnly(remote, fetchError);

	return json({
		entries,
		legend: {
			costTier: 'low = lower typical $/token; high = flagship / heaviest reasoning.',
			qualityTier:
				'capable = solid for routine extraction; strong = fewer mistakes; frontier = hardest documents.',
			speed: 'fast = quicker passes; thorough = deeper reasoning, often slower.',
			disclaimer:
				'Relative tiers are heuristic. The model list is exactly what Restormel Keys exposes for this project; routing and entitlements are enforced there.',
			remoteModels:
				'Models come only from Restormel GET /projects/{id}/models. If the list is empty, fix gateway configuration or project model index in Restormel Keys.'
		},
		catalogSync: sync
	});
};
