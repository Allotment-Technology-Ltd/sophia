import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { fetchDatasetTopicPresetCoverage } from '$lib/server/metrics/datasetTopicPresetCoverage';

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);
	try {
		const body = await fetchDatasetTopicPresetCoverage();
		return json(body);
	} catch (e) {
		console.warn('[dataset-coverage]', e instanceof Error ? e.message : String(e));
		return json(
			{
				error: e instanceof Error ? e.message : 'Failed to load dataset coverage metrics.',
				generatedAt: new Date().toISOString()
			},
			{ status: 500 }
		);
	}
};
