import { json, type RequestHandler } from '@sveltejs/kit';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	rejectUnresolvedThinkerReference,
	resolveUnresolvedThinkerReference
} from '$lib/server/thinkerReviewQueue';

interface ResolveBody {
	action: 'resolve' | 'reject';
	wikidata_id?: string;
	label?: string;
	notes?: string;
}

function parseQueueRecordId(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return '';
	return trimmed.includes(':') ? trimmed.split(':').slice(1).join(':') : trimmed;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	assertAdminAccess(locals);
	const queueRecordId = parseQueueRecordId(params.id ?? '');
	if (!queueRecordId) {
		return json({ error: 'Queue record id is required' }, { status: 400 });
	}

	let body: ResolveBody;
	try {
		body = (await request.json()) as ResolveBody;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (body.action !== 'resolve' && body.action !== 'reject') {
		return json({ error: "action must be 'resolve' or 'reject'" }, { status: 400 });
	}

	try {
		if (body.action === 'resolve') {
			const wikidataId = body.wikidata_id?.trim();
			if (!wikidataId) {
				return json({ error: 'wikidata_id is required for resolve' }, { status: 400 });
			}
			const result = await resolveUnresolvedThinkerReference({
				queueRecordId,
				wikidataId,
				label: body.label?.trim() || null,
				notes: body.notes?.trim() || null
			});
			return json({
				ok: true,
				action: 'resolve',
				queue_record_id: queueRecordId,
				wikidata_id: wikidataId,
				linked_sources: result.linkedSources
			});
		}

		await rejectUnresolvedThinkerReference({
			queueRecordId,
			notes: body.notes?.trim() || null
		});
		return json({
			ok: true,
			action: 'reject',
			queue_record_id: queueRecordId
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		if (message.includes('not found') || message.includes('Invalid')) {
			return json({ error: message }, { status: 400 });
		}
		throw error;
	}
};
