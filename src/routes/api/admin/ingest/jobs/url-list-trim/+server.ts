import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { trimJobUrlListForNewRun } from '$lib/server/ingestion/jobUrlListTrim';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

function parseDays(v: unknown): number {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
	if (!Number.isFinite(n) || n < 1 || n > 730) return 90;
	return Math.trunc(n);
}

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		assertAdminAccess(locals);
		if (!isNeonIngestPersistenceEnabled()) {
			return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
		}
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ error: 'Invalid JSON body.' }, { status: 400 });
		}
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			return json({ error: 'Body must be a JSON object.' }, { status: 400 });
		}
		const o = body as Record<string, unknown>;
		const urlsRaw = o.urls;
		if (!Array.isArray(urlsRaw)) {
			return json({ error: 'Field "urls" must be an array of strings.' }, { status: 400 });
		}
		const urls = urlsRaw.filter((u): u is string => typeof u === 'string');
		const days = parseDays(o.days);
		const stripTrainingAcceptable = o.stripTrainingAcceptable === true;
		const stripGoldenValidationDone = o.stripGoldenValidationDone === true;
		const stripDlqPermanent = o.stripDlqPermanent === true;

		if (!stripTrainingAcceptable && !stripGoldenValidationDone && !stripDlqPermanent) {
			return json(
				{ error: 'Enable at least one of stripTrainingAcceptable, stripGoldenValidationDone, stripDlqPermanent.' },
				{ status: 400 }
			);
		}

		const result = await trimJobUrlListForNewRun(urls, {
			days,
			stripTrainingAcceptable,
			stripGoldenValidationDone,
			stripDlqPermanent
		});

		return json({
			days,
			inputCount: urls.length,
			keptCount: result.kept.length,
			removedCounts: {
				trainingAcceptable: result.removed.trainingAcceptable.length,
				goldenValidationDone: result.removed.goldenValidationDone.length,
				dlqPermanent: result.removed.dlqPermanent.length
			},
			kept: result.kept,
			removed: result.removed
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'URL list trim failed';
		return json({ error: message }, { status: 500 });
	}
};
