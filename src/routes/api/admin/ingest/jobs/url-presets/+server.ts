import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	cohortFingerprintFromUrlList,
	listTrainingAcceptableUrlsFromNeon,
	omitUrlsWithCompletedValidationTelemetry
} from '$lib/server/ingestion/trainingAcceptableCohortNeon';
import {
	goldenExtractionEvalFingerprint,
	loadGoldenExtractionEval
} from '$lib/server/ingestion/goldenExtractionEval';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

function parseDays(raw: string | null): number {
	const n = raw ? parseInt(raw, 10) : 90;
	if (!Number.isFinite(n) || n < 1 || n > 730) return 90;
	return n;
}

function parseLimit(raw: string | null): number {
	const n = raw ? parseInt(raw, 10) : 500;
	if (!Number.isFinite(n) || n < 1) return 500;
	return Math.min(5000, n);
}

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		assertAdminAccess(locals);
		const preset = (url.searchParams.get('preset') ?? '').trim().toLowerCase();
		if (!preset) {
			return json({ error: 'Missing preset (golden | training_acceptable)' }, { status: 400 });
		}

		if (preset === 'golden') {
			const data = loadGoldenExtractionEval();
			const def = (data.default_source_type ?? 'sep_entry').trim();
			let rows = data.items.map((it) => ({
				url: it.url.trim(),
				source_type: (it.source_type ?? def).trim(),
				why: typeof it.why === 'string' ? it.why : undefined
			}));
			const omitValidated =
				url.searchParams.get('omit_validated') === '1' ||
				url.searchParams.get('omit_validated') === 'true';
			if (omitValidated && isNeonIngestPersistenceEnabled() && rows.length > 0) {
				const days = parseDays(url.searchParams.get('days'));
				const kept = await omitUrlsWithCompletedValidationTelemetry(
					rows.map((r) => r.url),
					days
				);
				const keptLc = new Set(kept.map((u) => u.trim().toLowerCase()));
				rows = rows.filter((r) => keptLc.has(r.url.trim().toLowerCase()));
			}
			const fp = goldenExtractionEvalFingerprint(
				rows.map((r) => ({ url: r.url, source_type: r.source_type, why: r.why }))
			);
			return json({
				preset: 'golden',
				version: data.version,
				description: data.description ?? null,
				urlCount: rows.length,
				cohortFingerprint: fp,
				omitValidatedTelemetry: omitValidated,
				urls: rows
			});
		}

		if (preset === 'training_acceptable') {
			if (!isNeonIngestPersistenceEnabled()) {
				return json({ error: 'Neon ingest persistence is not enabled.' }, { status: 503 });
			}
			const days = parseDays(url.searchParams.get('days'));
			const limit = parseLimit(url.searchParams.get('limit'));
			const validateOnly = url.searchParams.get('validate') === '1' || url.searchParams.get('validate') === 'true';
			const omitValidatedTelemetry =
				url.searchParams.get('omit_validated') === '1' ||
				url.searchParams.get('omit_validated') === 'true';
			const { urls, cohortMeta } = await listTrainingAcceptableUrlsFromNeon({
				days,
				limit,
				validateOnly,
				omitValidatedTelemetry
			});
			const fp = cohortFingerprintFromUrlList(urls.map((u) => u.url));
			return json({
				preset: 'training_acceptable',
				days: cohortMeta.days,
				validateOnly,
				omitValidatedTelemetry,
				scannedRunCount: cohortMeta.scannedRunCount,
				urlCount: urls.length,
				cohortFingerprint: fp,
				urls: urls.map((u) => ({
					url: u.url,
					source_type: u.sourceType,
					run_id: u.runId,
					completed_at: u.completedAt,
					validate: u.validate
				}))
			});
		}

		return json({ error: `Unknown preset: ${preset}` }, { status: 400 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to load URL preset';
		return json({ error: message }, { status: 500 });
	}
};
