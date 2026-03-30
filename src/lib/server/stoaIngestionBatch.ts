import { randomBytes, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { Timestamp } from '$lib/server/fsCompat';
import { query as dbQuery } from '$lib/server/db';
import { ingestRunManager, type IngestRunPayload } from '$lib/server/ingestRuns';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';

type QueueStatus = 'queued' | 'pending_review' | 'approved' | 'ingesting' | 'ingested' | 'failed' | 'rejected';
type ReuseMode = 'full_text' | 'metadata_only' | 'blocked';
type LicenseType = 'public_domain' | 'cc0' | 'cc_by' | 'cc_by_sa' | 'unknown';
type BatchStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled';
type BatchItemStatus = 'pending' | 'launching' | 'running' | 'done' | 'error' | 'cancelled' | 'skipped';

type QueueRow = {
	id: string;
	canonical_url: string;
	canonical_url_hash: string;
	hostname?: string;
	status?: QueueStatus;
	source_kinds?: string[];
	pass_hints?: string[];
	last_error?: string | null;
	title_hint?: string | null;
	updated_at?: string;
	last_submitted_at?: string;
	visibility_scope?: 'public_shared' | 'private_user_only';
};

export type StoaLicenseDecision = {
	url: string;
	canonicalUrl: string | null;
	hostname: string | null;
	allowed: boolean;
	reuseMode: ReuseMode;
	licenseType: LicenseType;
	licenseUrl: string | null;
	reuseNotes: string;
	reason: string | null;
	sourceType: IngestRunPayload['source_type'];
};

type BatchItem = {
	queueRecordId: string;
	url: string;
	hostname: string;
	status: BatchItemStatus;
	lastUpdatedAtMs: number;
	childRunId: string | null;
	error: string | null;
	licenseType: LicenseType;
	reuseMode: ReuseMode;
	sourceType: IngestRunPayload['source_type'];
	attempts: number;
};

type BatchRunDoc = {
	status: BatchStatus;
	createdAtMs: number;
	updatedAtMs: number;
	requestedByEmail: string | null;
	requestedByUid: string;
	sourcePackId: string | null;
	notes: string | null;
	concurrency: number;
	items: BatchItem[];
	summary: {
		total: number;
		pending: number;
		running: number;
		done: number;
		error: number;
		cancelled: number;
		skipped: number;
	};
};

export type StoaBatchRunView = BatchRunDoc & {
	id: string;
};

export type StoaSourcePack = {
	id: string;
	name: string;
	description: string;
	urls: string[];
};

const STOA_BATCH_COLLECTION = 'stoa_ingestion_batches';
const STOA_SOURCE_PACK_COLLECTION = 'stoa_ingestion_source_packs';
const inMemoryBatchLocks = new Set<string>();

const HOST_LICENSE_RULES: Array<{
	match: (host: string) => boolean;
	licenseType: LicenseType;
	licenseUrl: string;
	reuseMode: ReuseMode;
	notes: string;
	sourceType: IngestRunPayload['source_type'];
}> = [
	{
		match: (h) => h === 'gutenberg.org' || h.endsWith('.gutenberg.org'),
		licenseType: 'public_domain',
		licenseUrl: 'https://www.gutenberg.org/policy/permission.html',
		reuseMode: 'full_text',
		notes: 'Project Gutenberg public-domain text corpus.',
		sourceType: 'book'
	},
	{
		match: (h) => h === 'en.wikisource.org' || h.endsWith('.wikisource.org'),
		licenseType: 'cc_by_sa',
		licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
		reuseMode: 'full_text',
		notes: 'Wikisource text under CC BY-SA; maintain attribution + share-alike.',
		sourceType: 'book'
	},
	{
		match: (h) => h === 'perseus.tufts.edu' || h.endsWith('.perseus.tufts.edu'),
		licenseType: 'cc_by_sa',
		licenseUrl: 'https://www.perseus.tufts.edu/hopper/opensource',
		reuseMode: 'full_text',
		notes: 'Ingest only pages explicitly marked CC/open in Perseus.',
		sourceType: 'book'
	},
	{
		match: (h) => h === 'wikidata.org' || h.endsWith('.wikidata.org') || h === 'query.wikidata.org',
		licenseType: 'cc0',
		licenseUrl: 'https://www.wikidata.org/wiki/Wikidata:Licensing',
		reuseMode: 'metadata_only',
		notes: 'Use for thinker/graph metadata enrichment.',
		sourceType: 'institutional'
	},
	{
		match: (h) => h === 'wikipedia.org' || h.endsWith('.wikipedia.org') || h.endsWith('.wikimedia.org'),
		licenseType: 'cc_by_sa',
		licenseUrl: 'https://dumps.wikimedia.org/legal.html',
		reuseMode: 'metadata_only',
		notes: 'Use as context metadata and links; preserve CC BY-SA attribution.',
		sourceType: 'institutional'
	},
	{
		match: (h) => h === 'pleiades.stoa.org' || h.endsWith('.pleiades.stoa.org'),
		licenseType: 'cc_by',
		licenseUrl: 'https://pleiades.stoa.org/help/using-pleiades-data',
		reuseMode: 'metadata_only',
		notes: 'Ancient place metadata for immersive context.',
		sourceType: 'institutional'
	},
	{
		match: (h) => h === 'archive.org' || h.endsWith('.archive.org'),
		licenseType: 'public_domain',
		licenseUrl: 'https://archive.org/about/terms.php',
		reuseMode: 'metadata_only',
		notes: 'Internet Archive contains mixed rights; default to metadata-only unless manually promoted.',
		sourceType: 'book'
	}
];

const DEFAULT_SOURCE_PACKS: StoaSourcePack[] = [
	{
		id: 'stoa-primary-core',
		name: 'STOA Primary Core',
		description: 'Core Stoic primary texts from open corpora.',
		urls: [
			'https://www.gutenberg.org/ebooks/2680',
			'https://www.gutenberg.org/ebooks/45109',
			'https://en.wikisource.org/wiki/Enchiridion',
			'https://en.wikisource.org/wiki/Epictetus,_the_Discourses_as_reported_by_Arrian,_the_Manual,_and_Fragments'
		]
	},
	{
		id: 'stoa-context-core',
		name: 'STOA Context Core',
		description: 'Open-license contextual datasets for timeline, place, and thinker graph enrichment.',
		urls: [
			'https://www.wikidata.org/wiki/Wikidata:Main_Page',
			'https://en.wikipedia.org/wiki/Stoicism',
			'https://pleiades.stoa.org/'
		]
	}
];

function nowMs(): number {
	return Date.now();
}

function batchDocRef(batchId: string) {
	return sophiaDocumentsDb.collection(STOA_BATCH_COLLECTION).doc(batchId);
}

function sourcePackDocRef(packId: string) {
	return sophiaDocumentsDb.collection(STOA_SOURCE_PACK_COLLECTION).doc(packId);
}

function normalizeRecordId(value: unknown): string | null {
	if (typeof value === 'string' && value.trim()) return value.trim();
	if (value && typeof value === 'object') {
		const rec = value as { tb?: unknown; id?: unknown };
		if (typeof rec.tb === 'string' && rec.id !== undefined) return `${rec.tb}:${String(rec.id)}`;
		if (typeof rec.id === 'string') return rec.id.trim();
	}
	return null;
}

function parseQueueRows(rows: unknown): QueueRow[] {
	if (!Array.isArray(rows)) return [];
	return rows.filter((row): row is QueueRow => !!row && typeof row === 'object') as QueueRow[];
}

function isDisallowedHost(hostname: string): boolean {
	const normalized = hostname.trim().toLowerCase();
	if (!normalized) return true;
	if (
		normalized === 'localhost' ||
		normalized.endsWith('.local') ||
		normalized.endsWith('.internal') ||
		normalized.endsWith('.home.arpa')
	) {
		return true;
	}
	if (!isIP(normalized)) return false;
	if (normalized === '::1') return true;
	if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
	const octets = normalized.split('.').map((part) => Number.parseInt(part, 10));
	if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
	const [a, b] = octets;
	if (a === 10 || a === 127 || a === 0) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	return false;
}

export function canonicalizeQueueUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
	if (isDisallowedHost(parsed.hostname)) return null;
	parsed.hash = '';
	if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
	return parsed.toString();
}

function canonicalHash(canonicalUrl: string): string {
	return createHash('sha256').update(`public_shared::${canonicalUrl}`).digest('hex');
}

function safeSourceTypeFromHost(hostname: string): IngestRunPayload['source_type'] {
	const low = hostname.toLowerCase();
	if (low === 'gutenberg.org' || low.endsWith('.gutenberg.org')) return 'book';
	if (low === 'en.wikisource.org' || low.endsWith('.wikisource.org')) return 'book';
	if (low === 'perseus.tufts.edu' || low.endsWith('.perseus.tufts.edu')) return 'book';
	if (low.includes('arxiv.org')) return 'paper';
	if (low.includes('iep.utm.edu')) return 'iep_entry';
	if (low.includes('plato.stanford.edu')) return 'sep_entry';
	return 'institutional';
}

export function evaluateStoaLicense(url: string): StoaLicenseDecision {
	const canonicalUrl = canonicalizeQueueUrl(url);
	if (!canonicalUrl) {
		return {
			url,
			canonicalUrl: null,
			hostname: null,
			allowed: false,
			reuseMode: 'blocked',
			licenseType: 'unknown',
			licenseUrl: null,
			reuseNotes: '',
			reason: 'Invalid or blocked URL.',
			sourceType: 'institutional'
		};
	}
	const hostname = new URL(canonicalUrl).hostname.toLowerCase();
	const rule = HOST_LICENSE_RULES.find((r) => r.match(hostname));
	if (!rule) {
		return {
			url,
			canonicalUrl,
			hostname,
			allowed: false,
			reuseMode: 'blocked',
			licenseType: 'unknown',
			licenseUrl: null,
			reuseNotes: '',
			reason: 'Host not in strict-open STOA allowlist.',
			sourceType: safeSourceTypeFromHost(hostname)
		};
	}
	return {
		url,
		canonicalUrl,
		hostname,
		allowed: rule.reuseMode !== 'blocked',
		reuseMode: rule.reuseMode,
		licenseType: rule.licenseType,
		licenseUrl: rule.licenseUrl,
		reuseNotes: rule.notes,
		reason: null,
		sourceType: rule.sourceType
	};
}

function mergeUnique(existing: string[] | undefined, next: string[]): string[] {
	return [...new Set([...(existing ?? []), ...next])];
}

async function upsertQueueRowForStoa(decision: StoaLicenseDecision, actorUid: string): Promise<{ id: string; status: QueueStatus }> {
	if (!decision.canonicalUrl || !decision.hostname) {
		throw new Error('Cannot queue invalid URL');
	}
	const canonicalUrl = decision.canonicalUrl;
	const canonicalUrlHash = canonicalHash(canonicalUrl);
	const existingRows = await dbQuery<QueueRow[]>(
		`SELECT id, status, source_kinds, pass_hints
		 FROM link_ingestion_queue
		 WHERE canonical_url_hash = $canonical_url_hash
		 LIMIT 1`,
		{ canonical_url_hash: canonicalUrlHash }
	);
	const existing = parseQueueRows(existingRows)[0] ?? null;
	const initialStatus: QueueStatus =
		decision.reuseMode === 'blocked'
			? 'rejected'
			: decision.reuseMode === 'metadata_only'
				? 'pending_review'
				: 'approved';
	const passHints = [
		'stoa_batch',
		`license:${decision.licenseType}`,
		`reuse:${decision.reuseMode}`,
		decision.licenseUrl ? `license_url:${decision.licenseUrl}` : ''
	].filter(Boolean);

	if (existing?.id) {
		const rowId = normalizeRecordId(existing.id);
		if (!rowId) throw new Error('Invalid queue row id');
		const nextStatus: QueueStatus =
			existing.status === 'ingesting' || existing.status === 'queued' ? existing.status : initialStatus;
		await dbQuery(
			`UPDATE type::thing($id) MERGE {
				 status: $status,
				 source_kinds: $source_kinds,
				 pass_hints: $pass_hints,
				 submitted_by_uid: $submitted_by_uid,
				 submitted_by_uids: array::add(submitted_by_uids, $submitted_by_uid),
				 title_hint: if title_hint = NONE then $title_hint else title_hint end,
				 last_error: if $status = 'rejected' then $last_error else NONE end,
				 last_submitted_at: time::now(),
				 updated_at: time::now(),
				 approved_at: if $status = 'approved' then time::now() else approved_at end
			 }`,
			{
				id: rowId,
				status: nextStatus,
				source_kinds: mergeUnique(existing.source_kinds, ['stoa', 'stoa_batch']),
				pass_hints: mergeUnique(existing.pass_hints, passHints),
				submitted_by_uid: actorUid,
				title_hint: `STOA batch: ${decision.hostname}`,
				last_error: decision.reuseMode === 'blocked' ? 'stoa_strict_open_blocked' : null
			}
		);
		return { id: rowId, status: nextStatus };
	}

	const createdRows = await dbQuery<Array<{ id: string }>>(
		`CREATE link_ingestion_queue CONTENT {
			 canonical_url: $canonical_url,
			 canonical_url_hash: $canonical_url_hash,
			 hostname: $hostname,
			 visibility_scope: 'public_shared',
			 owner_uid: NONE,
			 contributor_uid: $contributor_uid,
			 deletion_state: 'active',
			 status: $status,
			 source_kinds: ['stoa', 'stoa_batch'],
			 query_run_ids: [],
			 latest_query_run_id: NONE,
			 submitted_by_uid: $submitted_by_uid,
			 submitted_by_uids: [$submitted_by_uid],
			 title_hint: $title_hint,
			 pass_hints: $pass_hints,
			 user_submission_count: 0,
			 grounding_submission_count: 0,
			 total_submission_count: 1,
			 attempt_count: 0,
			 last_error: $last_error,
			 created_at: time::now(),
			 queued_at: time::now(),
			 last_submitted_at: time::now(),
			 updated_at: time::now(),
			 approved_at: if $status = 'approved' then time::now() else NONE end
		 }`,
		{
			canonical_url: canonicalUrl,
			canonical_url_hash: canonicalUrlHash,
			hostname: decision.hostname,
			contributor_uid: actorUid,
			submitted_by_uid: actorUid,
			status: initialStatus,
			title_hint: `STOA batch: ${decision.hostname}`,
			pass_hints: passHints,
			last_error: decision.reuseMode === 'blocked' ? 'stoa_strict_open_blocked' : null
		}
	);
	const createdId = normalizeRecordId(createdRows?.[0]?.id);
	if (!createdId) throw new Error('Queue record creation failed');
	return { id: createdId, status: initialStatus };
}

function summarize(items: BatchItem[]) {
	return {
		total: items.length,
		pending: items.filter((i) => i.status === 'pending' || i.status === 'launching').length,
		running: items.filter((i) => i.status === 'running').length,
		done: items.filter((i) => i.status === 'done').length,
		error: items.filter((i) => i.status === 'error').length,
		cancelled: items.filter((i) => i.status === 'cancelled').length,
		skipped: items.filter((i) => i.status === 'skipped').length
	};
}

function buildBatchId(): string {
	return `stoa_batch_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

function toTimestamp(ms: number): Timestamp {
	return Timestamp.fromMillis(ms);
}

function toBatchView(id: string, data: Record<string, unknown>): StoaBatchRunView {
	return {
		id,
		status: (data.status as BatchStatus) ?? 'running',
		createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0,
		updatedAtMs: typeof data.updatedAtMs === 'number' ? data.updatedAtMs : 0,
		requestedByEmail: typeof data.requestedByEmail === 'string' ? data.requestedByEmail : null,
		requestedByUid: typeof data.requestedByUid === 'string' ? data.requestedByUid : '',
		sourcePackId: typeof data.sourcePackId === 'string' ? data.sourcePackId : null,
		notes: typeof data.notes === 'string' ? data.notes : null,
		concurrency: typeof data.concurrency === 'number' ? data.concurrency : 1,
		items: Array.isArray(data.items) ? (data.items as BatchItem[]) : [],
		summary:
			data.summary && typeof data.summary === 'object'
				? (data.summary as BatchRunDoc['summary'])
				: summarize(Array.isArray(data.items) ? (data.items as BatchItem[]) : [])
	};
}

async function listAllBatchRuns(): Promise<StoaBatchRunView[]> {
	const snap = await sophiaDocumentsDb.collection(STOA_BATCH_COLLECTION).get();
	const runs = snap.docs.map((doc) => toBatchView(doc.id, doc.data() ?? {}));
	runs.sort((a, b) => b.createdAtMs - a.createdAtMs);
	return runs;
}

async function getBatchRun(batchId: string): Promise<StoaBatchRunView | null> {
	const snap = await batchDocRef(batchId).get();
	if (!snap.exists) return null;
	return toBatchView(batchId, snap.data() ?? {});
}

async function saveBatchRun(batch: StoaBatchRunView): Promise<void> {
	const updatedAtMs = nowMs();
	await batchDocRef(batch.id).set({
		status: batch.status,
		createdAtMs: batch.createdAtMs,
		createdAt: toTimestamp(batch.createdAtMs),
		updatedAtMs,
		updatedAt: toTimestamp(updatedAtMs),
		requestedByEmail: batch.requestedByEmail,
		requestedByUid: batch.requestedByUid,
		sourcePackId: batch.sourcePackId,
		notes: batch.notes,
		concurrency: batch.concurrency,
		items: batch.items,
		summary: summarize(batch.items)
	});
}

async function reserveQueueRow(queueRecordId: string): Promise<boolean> {
	const result = await dbQuery<Array<{ id: string }>>(
		`UPDATE type::thing($id) SET
			 status = 'queued',
			 updated_at = time::now(),
			 last_error = NONE
		 WHERE status = 'approved'
		 RETURN AFTER`,
		{ id: queueRecordId }
	);
	return Array.isArray(result) && result.length > 0;
}

async function maybeLaunchQueuedItems(batch: StoaBatchRunView): Promise<StoaBatchRunView> {
	if (batch.status !== 'running') return batch;
	const runningCount = batch.items.filter((i) => i.status === 'running' || i.status === 'launching').length;
	const slots = Math.max(0, batch.concurrency - runningCount);
	if (slots <= 0) return batch;

	const pendingItems = batch.items.filter((i) => i.status === 'pending').slice(0, slots);
	for (const item of pendingItems) {
		item.status = 'launching';
		item.lastUpdatedAtMs = nowMs();
		try {
			const reserved = await reserveQueueRow(item.queueRecordId);
			if (!reserved) {
				item.status = 'skipped';
				item.error = 'Queue row no longer approved (already claimed or status changed).';
				item.lastUpdatedAtMs = nowMs();
				continue;
			}
			const payload: IngestRunPayload = {
				source_url: item.url,
				source_type: item.sourceType,
				validate: false,
				stop_before_store: true,
				model_chain: { extract: 'auto', relate: 'auto', group: 'auto', validate: 'auto' },
				queue_record_id: item.queueRecordId
			};
			const childRunId = await ingestRunManager.createRun(payload, batch.requestedByEmail ?? 'stoa-batch@sophia.local');
			item.childRunId = childRunId;
			item.status = 'running';
			item.attempts += 1;
			item.error = null;
			item.lastUpdatedAtMs = nowMs();
		} catch (error) {
			item.status = 'error';
			item.error = error instanceof Error ? error.message : String(error);
			item.lastUpdatedAtMs = nowMs();
		}
	}
	return batch;
}

async function refreshChildStates(batch: StoaBatchRunView): Promise<StoaBatchRunView> {
	for (const item of batch.items) {
		if (!item.childRunId) continue;
		if (item.status !== 'running') continue;
		const state = await ingestRunManager.getStateAsync(item.childRunId);
		if (!state) continue;
		if (state.status === 'done') {
			item.status = 'done';
			item.error = null;
			item.lastUpdatedAtMs = nowMs();
		} else if (state.status === 'error') {
			item.status = 'error';
			item.error = state.error ?? 'Run failed';
			item.lastUpdatedAtMs = nowMs();
		}
	}
	return batch;
}

function finalizeBatchStatus(batch: StoaBatchRunView): StoaBatchRunView {
	const sum = summarize(batch.items);
	if (batch.status === 'cancelled' || batch.status === 'paused') return batch;
	if (sum.pending > 0 || sum.running > 0) return batch;
	if (sum.error > 0) batch.status = 'error';
	else batch.status = 'done';
	return batch;
}

export async function queueStoaUrls(args: {
	urls: string[];
	actorUid: string;
	sourcePackId?: string | null;
}): Promise<{
	queued: Array<{
		url: string;
		canonicalUrl: string;
		queueRecordId: string;
		status: QueueStatus;
		licenseType: LicenseType;
		reuseMode: ReuseMode;
		sourceType: IngestRunPayload['source_type'];
	}>;
	rejected: Array<{ url: string; reason: string }>;
}> {
	const uniqueUrls = Array.from(new Set(args.urls.map((u) => u.trim()).filter(Boolean)));
	const queued: Array<{
		url: string;
		canonicalUrl: string;
		queueRecordId: string;
		status: QueueStatus;
		licenseType: LicenseType;
		reuseMode: ReuseMode;
		sourceType: IngestRunPayload['source_type'];
	}> = [];
	const rejected: Array<{ url: string; reason: string }> = [];

	for (const url of uniqueUrls) {
		const decision = evaluateStoaLicense(url);
		if (!decision.allowed || !decision.canonicalUrl) {
			rejected.push({ url, reason: decision.reason ?? 'Blocked by policy' });
			continue;
		}
		const row = await upsertQueueRowForStoa(decision, args.actorUid);
		queued.push({
			url,
			canonicalUrl: decision.canonicalUrl,
			queueRecordId: row.id,
			status: row.status,
			licenseType: decision.licenseType,
			reuseMode: decision.reuseMode,
			sourceType: decision.sourceType
		});
	}
	return { queued, rejected };
}

export async function listStoaQueue(filters?: {
	status?: QueueStatus | 'all';
	limit?: number;
}): Promise<QueueRow[]> {
	const limit = Math.max(1, Math.min(500, filters?.limit ?? 120));
	const status = filters?.status ?? 'all';
	if (status === 'all') {
		const rows = await dbQuery<QueueRow[]>(
			`SELECT id, canonical_url, canonical_url_hash, hostname, status, source_kinds, pass_hints, last_error, title_hint, updated_at, last_submitted_at, visibility_scope
			 FROM link_ingestion_queue
			 WHERE array::contains(source_kinds, 'stoa') OR array::contains(source_kinds, 'stoa_batch')
			 ORDER BY last_submitted_at DESC
			 LIMIT $limit`,
			{ limit }
		);
		return parseQueueRows(rows);
	}
	const rows = await dbQuery<QueueRow[]>(
		`SELECT id, canonical_url, canonical_url_hash, hostname, status, source_kinds, pass_hints, last_error, title_hint, updated_at, last_submitted_at, visibility_scope
		 FROM link_ingestion_queue
		 WHERE (array::contains(source_kinds, 'stoa') OR array::contains(source_kinds, 'stoa_batch'))
		   AND status = $status
		 ORDER BY last_submitted_at DESC
		 LIMIT $limit`,
		{ status, limit }
	);
	return parseQueueRows(rows);
}

export async function bulkSetQueueStatus(args: {
	recordIds: string[];
	status: Extract<QueueStatus, 'approved' | 'rejected' | 'pending_review'>;
	reason?: string | null;
}): Promise<{ updated: number }> {
	let updated = 0;
	for (const recordId of args.recordIds) {
		const id = normalizeRecordId(recordId);
		if (!id) continue;
		await dbQuery(
			`UPDATE type::thing($id) MERGE {
				 status: $status,
				 updated_at: time::now(),
				 approved_at: if $status = 'approved' then time::now() else approved_at end,
				 last_error: if $status = 'rejected' then $last_error else NONE end
			 }`,
			{ id, status: args.status, last_error: args.reason ?? 'manually_rejected' }
		);
		updated += 1;
	}
	return { updated };
}

export async function createStoaBatchRun(args: {
	actorUid: string;
	actorEmail: string | null;
	concurrency: number;
	limit: number;
	statusFilter?: QueueStatus;
	sourcePackId?: string | null;
	notes?: string | null;
}): Promise<StoaBatchRunView> {
	const concurrency = Math.max(1, Math.min(8, args.concurrency || 2));
	const limit = Math.max(1, Math.min(200, args.limit || 30));
	const statusFilter = args.statusFilter ?? 'approved';
	const queueRows = await listStoaQueue({ status: statusFilter, limit });
	const items: BatchItem[] = queueRows.map((row) => {
		const hostname = typeof row.hostname === 'string' && row.hostname ? row.hostname : new URL(row.canonical_url).hostname;
		const decision = evaluateStoaLicense(row.canonical_url);
		return {
			queueRecordId: normalizeRecordId(row.id) ?? String(row.id),
			url: row.canonical_url,
			hostname,
			status: 'pending',
			lastUpdatedAtMs: nowMs(),
			childRunId: null,
			error: null,
			licenseType: decision.licenseType,
			reuseMode: decision.reuseMode,
			sourceType: decision.sourceType,
			attempts: 0
		};
	});
	const id = buildBatchId();
	const createdAtMs = nowMs();
	const batch: StoaBatchRunView = {
		id,
		status: 'running',
		createdAtMs,
		updatedAtMs: createdAtMs,
		requestedByEmail: args.actorEmail,
		requestedByUid: args.actorUid,
		sourcePackId: args.sourcePackId ?? null,
		notes: args.notes ?? null,
		concurrency,
		items,
		summary: summarize(items)
	};
	await saveBatchRun(batch);
	const refreshed = await refreshBatchRunStatus(id);
	return refreshed ?? batch;
}

export async function refreshBatchRunStatus(batchId: string): Promise<StoaBatchRunView | null> {
	if (inMemoryBatchLocks.has(batchId)) return getBatchRun(batchId);
	inMemoryBatchLocks.add(batchId);
	try {
		let batch = await getBatchRun(batchId);
		if (!batch) return null;
		batch = await refreshChildStates(batch);
		batch = await maybeLaunchQueuedItems(batch);
		batch = finalizeBatchStatus(batch);
		await saveBatchRun(batch);
		return batch;
	} finally {
		inMemoryBatchLocks.delete(batchId);
	}
}

export async function listBatchRuns(limit = 40): Promise<StoaBatchRunView[]> {
	const all = await listAllBatchRuns();
	return all.slice(0, Math.max(1, Math.min(200, limit)));
}

export async function cancelBatchRun(batchId: string): Promise<StoaBatchRunView | null> {
	const batch = await getBatchRun(batchId);
	if (!batch) return null;
	for (const item of batch.items) {
		if (item.childRunId && item.status === 'running') {
			const result = ingestRunManager.cancelRun(item.childRunId);
			if (!result.ok && !result.error.toLowerCase().includes('not found')) {
				item.error = result.error;
			}
			item.status = 'cancelled';
			item.lastUpdatedAtMs = nowMs();
		} else if (item.status === 'pending' || item.status === 'launching') {
			item.status = 'cancelled';
			item.lastUpdatedAtMs = nowMs();
		}
	}
	batch.status = 'cancelled';
	await saveBatchRun(batch);
	return batch;
}

export async function resumeBatchRun(batchId: string): Promise<StoaBatchRunView | null> {
	const batch = await getBatchRun(batchId);
	if (!batch) return null;
	batch.status = 'running';
	for (const item of batch.items) {
		if (item.status === 'cancelled' || item.status === 'error') {
			item.status = 'pending';
			item.error = null;
			item.lastUpdatedAtMs = nowMs();
		}
	}
	await saveBatchRun(batch);
	return refreshBatchRunStatus(batchId);
}

export async function getSourcePacks(): Promise<StoaSourcePack[]> {
	const collection = sophiaDocumentsDb.collection(STOA_SOURCE_PACK_COLLECTION);
	const snap = await collection.get();
	const docs = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) })) as Array<Record<string, unknown>>;
	const custom = docs
		.filter((d) => Array.isArray(d.urls))
		.map(
			(d) =>
				({
					id: typeof d.id === 'string' ? d.id : `pack_${randomBytes(4).toString('hex')}`,
					name: typeof d.name === 'string' ? d.name : 'Custom pack',
					description: typeof d.description === 'string' ? d.description : '',
					urls: (d.urls as unknown[]).map((u) => (typeof u === 'string' ? u : '')).filter(Boolean)
				}) satisfies StoaSourcePack
		);
	const merged = [...DEFAULT_SOURCE_PACKS];
	for (const pack of custom) {
		if (!merged.some((p) => p.id === pack.id)) merged.push(pack);
	}
	return merged;
}

export async function saveSourcePack(pack: StoaSourcePack): Promise<void> {
	await sourcePackDocRef(pack.id).set({
		name: pack.name,
		description: pack.description,
		urls: pack.urls,
		updatedAt: Timestamp.now(),
		updatedAtMs: nowMs()
	});
}

export function estimateCoverageForPack(urls: string[]): {
	accepted: number;
	metadataOnly: number;
	blocked: number;
	decisions: StoaLicenseDecision[];
} {
	const decisions = urls.map((url) => evaluateStoaLicense(url));
	return {
		accepted: decisions.filter((d) => d.allowed && d.reuseMode === 'full_text').length,
		metadataOnly: decisions.filter((d) => d.allowed && d.reuseMode === 'metadata_only').length,
		blocked: decisions.filter((d) => !d.allowed).length,
		decisions
	};
}

