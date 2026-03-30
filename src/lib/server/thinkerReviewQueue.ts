import { query } from '$lib/server/db';
import { canonicalizeThinkerName } from '$lib/server/thinkerIdentity';

export interface UnresolvedThinkerReference {
	id: string;
	raw_name: string;
	canonical_name: string;
	source_ids: string[];
	contexts: string[];
	status: 'queued' | 'resolved' | 'rejected';
	seen_count: number;
	proposed_qids: string[];
	proposed_labels: string[];
	resolver_notes: string | null;
	first_seen_at: string | null;
	last_seen_at: string | null;
}

export interface ThinkerLinkSourcePreview {
	id: string;
	url: string | null;
	title: string | null;
	author: string[] | null;
	source_type: string | null;
}

function recordIdToString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string') {
		return (value as { id: string }).id;
	}
	return String(value ?? '');
}

function normalizeRecordKey(rawId: string): string | null {
	const normalized = rawId.includes(':') ? rawId.split(':').slice(1).join(':') : rawId;
	if (!/^[A-Za-z0-9_-]+$/.test(normalized)) return null;
	return normalized;
}

function normalizeSourceRecordIds(sourceIds: string[]): string[] {
	const out: string[] = [];
	for (const sourceId of sourceIds) {
		const normalized = normalizeRecordKey(sourceId);
		if (normalized) out.push(normalized);
	}
	return Array.from(new Set(out));
}

function normalizeQueueRow(row: Record<string, unknown>): UnresolvedThinkerReference {
	return {
		id: recordIdToString(row.id),
		raw_name: typeof row.raw_name === 'string' ? row.raw_name : '',
		canonical_name: typeof row.canonical_name === 'string' ? row.canonical_name : '',
		source_ids: Array.isArray(row.source_ids)
			? row.source_ids.filter((v): v is string => typeof v === 'string')
			: [],
		contexts: Array.isArray(row.contexts) ? row.contexts.filter((v): v is string => typeof v === 'string') : [],
		status:
			row.status === 'resolved' || row.status === 'rejected' || row.status === 'queued'
				? row.status
				: 'queued',
		seen_count: typeof row.seen_count === 'number' ? row.seen_count : 0,
		proposed_qids: Array.isArray(row.proposed_qids)
			? row.proposed_qids.filter((v): v is string => typeof v === 'string')
			: [],
		proposed_labels: Array.isArray(row.proposed_labels)
			? row.proposed_labels.filter((v): v is string => typeof v === 'string')
			: [],
		resolver_notes: typeof row.resolver_notes === 'string' ? row.resolver_notes : null,
		first_seen_at: typeof row.first_seen_at === 'string' ? row.first_seen_at : null,
		last_seen_at: typeof row.last_seen_at === 'string' ? row.last_seen_at : null
	};
}

export async function listUnresolvedThinkerReferences(params: {
	status?: 'queued' | 'resolved' | 'rejected' | 'all';
	limit?: number;
}): Promise<UnresolvedThinkerReference[]> {
	const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
	const status = params.status ?? 'queued';
	const rows = await query<Record<string, unknown>[]>(
		`SELECT * FROM unresolved_thinker_reference
		 WHERE $status = 'all' OR status = $status
		 ORDER BY last_seen_at DESC
		 LIMIT $limit`,
		{ status, limit }
	);
	return Array.isArray(rows) ? rows.map(normalizeQueueRow) : [];
}

export async function resolveUnresolvedThinkerReference(params: {
	queueRecordId: string;
	wikidataId: string;
	label?: string | null;
	notes?: string | null;
}): Promise<{ linkedSources: number }> {
	const queueRecordId = normalizeRecordKey(params.queueRecordId);
	const thinkerRecordId = normalizeRecordKey(params.wikidataId);
	if (!queueRecordId || !thinkerRecordId) {
		throw new Error('Invalid queue record id or Wikidata id');
	}

	const queueRows = await query<Record<string, unknown>[]>(
		`SELECT * FROM unresolved_thinker_reference
		 WHERE id = type::record('unresolved_thinker_reference', $queue_record_id)
		 LIMIT 1`,
		{ queue_record_id: queueRecordId }
	);
	const queueRow = Array.isArray(queueRows) && queueRows.length > 0 ? normalizeQueueRow(queueRows[0]) : null;
	if (!queueRow) throw new Error('Queue record not found');

	await query(
		`UPSERT type::record('thinker', $wikidata_id) CONTENT {
			wikidata_id: $wikidata_id,
			name: $name,
			traditions: [],
			domains: [],
			imported_at: time::now()
		}`,
		{
			wikidata_id: thinkerRecordId,
			name: params.label ?? queueRow.raw_name
		}
	);

	const sourceIds = normalizeSourceRecordIds(queueRow.source_ids);
	let linkedSources = 0;
	for (const sourceId of sourceIds) {
		const existing = await query<Record<string, unknown>[]>(
			`SELECT * FROM authored
			 WHERE in = type::record('thinker', $wikidata_id)
			   AND out = type::record('source', $source_id)
			 LIMIT 1`,
			{ wikidata_id: thinkerRecordId, source_id: sourceId }
		);
		if (Array.isArray(existing) && existing.length > 0) continue;

		await query(
			`LET $from = type::record('thinker', $wikidata_id);
			 LET $to = type::record('source', $source_id);
			 RELATE $from->authored->$to
			 SET match_type = 'manual_review',
			     confidence = 1.0,
			     linked_at = time::now()`,
			{ wikidata_id: thinkerRecordId, source_id: sourceId }
		);
		linkedSources += 1;
	}

	await query(
		`UPDATE type::record('unresolved_thinker_reference', $queue_record_id) MERGE {
			status: 'resolved',
			resolver_notes: $resolver_notes,
			last_seen_at: time::now(),
			proposed_qids: array::distinct(array::append(proposed_qids, $wikidata_id)),
			proposed_labels: array::distinct(array::append(proposed_labels, $label))
		}`,
		{
			resolver_notes: params.notes ?? `Manually resolved to ${params.wikidataId}`,
			queue_record_id: queueRecordId,
			wikidata_id: thinkerRecordId,
			label: params.label ?? queueRow.raw_name
		}
	);

	await query(
		`UPSERT thinker_alias:$alias_id CONTENT {
			canonical_name: $canonical_name,
			raw_name: $raw_name,
			wikidata_id: $wikidata_id,
			label: $label,
			confidence: 1.0,
			resolved_by: 'manual',
			status: 'active',
			source_contexts: $source_contexts,
			updated_at: time::now(),
			created_at: time::now()
		}`,
		{
			alias_id: queueRow.canonical_name.replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, ''),
			canonical_name: canonicalizeThinkerName(queueRow.raw_name),
			raw_name: queueRow.raw_name,
			wikidata_id: thinkerRecordId,
			label: params.label ?? queueRow.raw_name,
			source_contexts: queueRow.contexts
		}
	);

	await query(
		`CREATE thinker_resolution_audit_log CONTENT {
			raw_name: $raw_name,
			canonical_name: $canonical_name,
			wikidata_id: $wikidata_id,
			label: $label,
			action: 'manual_resolve',
			confidence: 1.0,
			queue_record_id: $queue_record_id,
			notes: $notes,
			created_at: time::now()
		}`,
		{
			raw_name: queueRow.raw_name,
			canonical_name: canonicalizeThinkerName(queueRow.raw_name),
			wikidata_id: thinkerRecordId,
			label: params.label ?? queueRow.raw_name,
			queue_record_id: queueRecordId,
			notes: params.notes ?? `Manually resolved to ${params.wikidataId}`
		}
	);

	return { linkedSources };
}

export async function rejectUnresolvedThinkerReference(params: {
	queueRecordId: string;
	notes?: string | null;
}): Promise<void> {
	const queueRecordId = normalizeRecordKey(params.queueRecordId);
	if (!queueRecordId) {
		throw new Error('Invalid queue record id');
	}
	await query(
		`UPDATE type::record('unresolved_thinker_reference', $queue_record_id) MERGE {
			status: 'rejected',
			resolver_notes: $resolver_notes,
			last_seen_at: time::now()
		}`,
		{
			queue_record_id: queueRecordId,
			resolver_notes: params.notes ?? 'Marked as non-thinker / not linkable'
		}
	);

	const queueRows = await query<Record<string, unknown>[]>(
		`SELECT * FROM unresolved_thinker_reference
		 WHERE id = type::record('unresolved_thinker_reference', $queue_record_id)
		 LIMIT 1`,
		{ queue_record_id: queueRecordId }
	);
	const queueRow = Array.isArray(queueRows) && queueRows.length > 0 ? normalizeQueueRow(queueRows[0]) : null;
	const rawName = queueRow?.raw_name ?? queueRecordId.replace(/_/g, ' ');
	const canonicalName = canonicalizeThinkerName(rawName);

	await query(
		`UPSERT thinker_alias:$alias_id CONTENT {
			canonical_name: $canonical_name,
			raw_name: $raw_name,
			wikidata_id: '',
			label: $raw_name,
			confidence: 1.0,
			resolved_by: 'manual',
			status: 'rejected',
			source_contexts: [],
			updated_at: time::now(),
			created_at: time::now()
		}`,
		{
			alias_id: canonicalName.replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, ''),
			canonical_name: canonicalName,
			raw_name: rawName
		}
	);

	await query(
		`CREATE thinker_resolution_audit_log CONTENT {
			raw_name: $raw_name,
			canonical_name: $canonical_name,
			action: 'manual_reject',
			confidence: NONE,
			queue_record_id: $queue_record_id,
			notes: $notes,
			created_at: time::now()
		}`,
		{
			raw_name: rawName,
			canonical_name: canonicalName,
			queue_record_id: queueRecordId,
			notes: params.notes ?? 'Marked as non-thinker / not linkable'
		}
	);
}

export async function listThinkerLinkSourcePreviews(sourceIds: string[]): Promise<ThinkerLinkSourcePreview[]> {
	const normalizedIds = Array.from(
		new Set(
			sourceIds
				.map((id) => normalizeRecordKey(id))
				.filter((id): id is string => typeof id === 'string' && id.length > 0)
		)
	).slice(0, 200);
	if (normalizedIds.length === 0) return [];

	const rows = await query<Record<string, unknown>[]>(
		`LET $source_records = array::map($source_ids, |$id| type::record('source', $id));
		 SELECT id, url, title, author, source_type
		 FROM source
		 WHERE id IN $source_records
		 LIMIT $limit`,
		{ source_ids: normalizedIds, limit: normalizedIds.length }
	);

	if (!Array.isArray(rows)) return [];
	return rows.map((row) => ({
		id: recordIdToString(row.id),
		url: typeof row.url === 'string' ? row.url : null,
		title: typeof row.title === 'string' ? row.title : null,
		author: Array.isArray(row.author) ? row.author.filter((v): v is string => typeof v === 'string') : null,
		source_type: typeof row.source_type === 'string' ? row.source_type : null
	}));
}
