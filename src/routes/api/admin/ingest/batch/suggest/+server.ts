import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	getCanonicalRepositoryOptions,
	getTraditionOptions,
	suggestSourcesForTradition,
	type CanonicalRepositoryId,
	type StoaTraditionId
} from '$lib/server/stoaIngestionBatch';

const allowedCounts = [5, 10, 15, 20, 25, 30] as const;

function parseTradition(value: unknown): StoaTraditionId | null {
	if (typeof value !== 'string') return null;
	const v = value.trim();
	if (
		v === 'stoicism' ||
		v === 'platonism' ||
		v === 'aristotelianism' ||
		v === 'epicureanism' ||
		v === 'skepticism' ||
		v === 'neoplatonism'
	) {
		return v;
	}
	return null;
}

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);
	return json({
		traditions: getTraditionOptions(),
		repositories: getCanonicalRepositoryOptions(),
		allowedCounts
	});
};

export const POST: RequestHandler = async ({ locals, request }) => {
	assertAdminAccess(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const payload = body as { tradition?: unknown; count?: unknown; repositories?: unknown };
	const tradition = parseTradition(payload.tradition);
	if (!tradition) return json({ error: 'tradition is required' }, { status: 400 });
	const countRaw = typeof payload.count === 'number' && Number.isFinite(payload.count) ? Math.trunc(payload.count) : 10;
	const count = allowedCounts.includes(countRaw as (typeof allowedCounts)[number]) ? countRaw : 10;
	const repositories = Array.isArray(payload.repositories)
		? (payload.repositories
				.map((v) => (typeof v === 'string' ? v.trim() : ''))
				.filter(Boolean) as CanonicalRepositoryId[])
		: [];
	const suggestion = suggestSourcesForTradition({
		tradition,
		count,
		repositories
	});
	return json(suggestion);
};

