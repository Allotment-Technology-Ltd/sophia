import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Surreal } from 'surrealdb';
import { segmentArgumentativePassages } from '../src/lib/server/ingestion/passageSegmentation.js';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';
const LOW_CONFIDENCE_REVIEW_THRESHOLD = Number(
	process.env.INGEST_LOW_CONFIDENCE_REVIEW_THRESHOLD || '0.65'
);
const MAX_TOKENS_PER_PASSAGE = Number(process.env.INGEST_MAX_TOKENS_PER_PASSAGE || '900');
const RELATION_TABLES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'defines',
	'qualifies',
	'refines',
	'exemplifies',
	'part_of'
] as const;

type LegacySource = {
	id: string;
	title?: string;
	url?: string;
	canonical_url_hash?: string;
};

type ClaimRow = {
	id: string;
	text?: string;
	position_in_source?: number;
	section_context?: string;
	source_span_start?: number;
	source_span_end?: number;
	passage?: string;
	passage_order?: number;
	passage_role?: string;
	claim_origin?: string;
	claim_scope?: string;
	review_state?: string;
	verification_state?: string;
};

type PassageRow = {
	id: string;
	order_in_source: number;
	section_title?: string | null;
	span_start: number;
	span_end: number;
	role: string;
};

type RelationRow = {
	id: string;
	in?: string;
	out?: string;
	evidence_passages?: string[] | null;
};

type SourceMeta = {
	url?: string;
	canonical_url?: string;
	canonical_url_hash?: string;
	local_slug?: string;
};

function sourceRecordId(sourceId: string | { tb?: string; id?: string } | unknown): string {
	if (typeof sourceId === 'string') return sourceId;
	if (sourceId && typeof sourceId === 'object') {
		const tb = (sourceId as { tb?: unknown }).tb;
		const id = (sourceId as { id?: unknown }).id;
		if (typeof tb === 'string' && id !== undefined) return `${tb}:${String(id)}`;
	}
	return String(sourceId ?? '');
}

function sourceIdPart(sourceId: string | { tb?: string; id?: string } | unknown): string {
	const raw = sourceRecordId(sourceId);
	return raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
}

type LocalSourceIndex = {
	byHash: Map<string, string>;
	byUrl: Map<string, string>;
};

function normalizeUrl(url?: string | null): string {
	if (!url) return '';
	return url.trim().replace(/\/+$/, '');
}

function parseArgs() {
	const args = process.argv.slice(2);
	const dryRun = args.includes('--dry-run');
	const force = args.includes('--force');
	const sourceId = readArg(args, '--source-id');
	const limitRaw = readArg(args, '--limit');
	const limit = limitRaw ? Number(limitRaw) : undefined;
	if (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
		throw new Error(`Invalid --limit value: ${limitRaw}`);
	}
	return { dryRun, force, sourceId, limit };
}

function readArg(args: string[], key: string): string | undefined {
	const index = args.indexOf(key);
	if (index < 0) return undefined;
	return args[index + 1];
}

async function connectDb(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

function buildLocalSourceIndex(): LocalSourceIndex {
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	const sourcesDir = path.resolve(scriptDir, '../data/sources');
	const files = fs.readdirSync(sourcesDir).filter((file) => file.endsWith('.meta.json'));
	const byHash = new Map<string, string>();
	const byUrl = new Map<string, string>();

	for (const metaFile of files) {
		const metaPath = path.join(sourcesDir, metaFile);
		let meta: SourceMeta | null = null;
		try {
			meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SourceMeta;
		} catch {
			continue;
		}
		if (!meta) continue;

		const localSlug = meta.local_slug || path.basename(metaFile, '.meta.json');
		const txtPath = path.join(sourcesDir, `${localSlug}.txt`);
		if (!fs.existsSync(txtPath)) continue;

		if (meta.canonical_url_hash) byHash.set(meta.canonical_url_hash, txtPath);
		const canonicalUrl = normalizeUrl(meta.canonical_url);
		if (canonicalUrl) byUrl.set(canonicalUrl, txtPath);
		const url = normalizeUrl(meta.url);
		if (url) byUrl.set(url, txtPath);
	}

	return { byHash, byUrl };
}

async function fetchLegacySources(db: Surreal): Promise<LegacySource[]> {
	const sources = (await db.query<LegacySource[][]>(
		'SELECT id,title,url,canonical_url_hash FROM source'
	))?.[0] ?? [];
	const legacy: LegacySource[] = [];
	for (const source of sources) {
		const sid = sourceRecordId(source.id);
		const sidPart = sourceIdPart(sid);
		const claims = (await db.query<Array<{ c?: number; count?: number }>[][]>(`SELECT count() AS c FROM claim WHERE source = type::thing('source', $sid_part) GROUP ALL`, {
			sid_part: sidPart
		}))?.[0] ?? [];
		const passages = (await db.query<Array<{ c?: number; count?: number }>[][]>(`SELECT count() AS c FROM passage WHERE source = type::thing('source', $sid_part) GROUP ALL`, {
			sid_part: sidPart
		}))?.[0] ?? [];
		const claimCount = Number(claims[0]?.c ?? claims[0]?.count ?? 0);
		const passageCount = Number(passages[0]?.c ?? passages[0]?.count ?? 0);
		if (claimCount > 0 && passageCount === 0) {
			legacy.push(source);
		}
	}
	return legacy;
}

function resolveLocalTextPath(source: LegacySource, index: LocalSourceIndex): string | null {
	if (source.canonical_url_hash && index.byHash.has(source.canonical_url_hash)) {
		return index.byHash.get(source.canonical_url_hash) ?? null;
	}
	const normalizedUrl = normalizeUrl(source.url);
	if (normalizedUrl && index.byUrl.has(normalizedUrl)) {
		return index.byUrl.get(normalizedUrl) ?? null;
	}
	return null;
}

function containsSpan(passage: PassageRow, start?: number, end?: number): boolean {
	if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
	const s = start as number;
	const e = end as number;
	return s >= passage.span_start && e <= passage.span_end;
}

function findMatchingPassage(
	claim: ClaimRow,
	claimIndex: number,
	claimsLength: number,
	passages: PassageRow[],
	sourceText: string
): PassageRow {
	const spanMatch = passages.find((passage) =>
		containsSpan(passage, claim.source_span_start, claim.source_span_end)
	);
	if (spanMatch) return spanMatch;

	if (typeof claim.text === 'string' && claim.text.trim().length > 24) {
		const exactIndex = sourceText.indexOf(claim.text);
		if (exactIndex >= 0) {
			const start = exactIndex;
			const end = exactIndex + claim.text.length - 1;
			const textMatch = passages.find((passage) => start >= passage.span_start && end <= passage.span_end);
			if (textMatch) return textMatch;
		}
	}

	const section = (claim.section_context || '').trim().toLowerCase();
	if (section) {
		const sectionMatch = passages.find((passage) => {
			const title = (passage.section_title || '').trim().toLowerCase();
			if (!title) return false;
			return title === section || title.includes(section) || section.includes(title);
		});
		if (sectionMatch) return sectionMatch;
	}

	if (claimsLength <= 1) return passages[0]!;
	const normalized = claimIndex / Math.max(1, claimsLength - 1);
	const passageIndex = Math.min(passages.length - 1, Math.max(0, Math.floor(normalized * passages.length)));
	return passages[passageIndex] ?? passages[passages.length - 1]!;
}

async function createPassages(
	db: Surreal,
	source: LegacySource,
	sourceText: string,
	dryRun: boolean
): Promise<PassageRow[]> {
	const sourceId = sourceRecordId(source.id);
	const segmented = segmentArgumentativePassages(sourceText, {
		maxTokensPerPassage: MAX_TOKENS_PER_PASSAGE
	});
	if (segmented.length === 0) return [];

	if (dryRun) {
		return segmented.map((passage, index) => ({
			id: `passage:dryrun-${source.id}-${index + 1}`,
			order_in_source: passage.order_in_source,
			section_title: passage.section_title,
			span_start: passage.span.start,
			span_end: passage.span.end,
			role: passage.role
		}));
	}

	const created: PassageRow[] = [];
	for (const passage of segmented) {
		const result = await db.query<any[][]>(
			`CREATE passage CONTENT {
				source: $source,
				text: $text,
				summary: $summary,
				section_title: $section_title,
				order_in_source: $order_in_source,
				span_start: $span_start,
				span_end: $span_end,
				role: $role,
				role_confidence: $role_confidence,
				review_state: $review_state,
				verification_state: $verification_state,
				extractor_version: $extractor_version
			}`,
			{
				source: sourceId,
				text: passage.text,
				summary: passage.summary,
				section_title: passage.section_title ?? undefined,
				order_in_source: passage.order_in_source,
				span_start: passage.span.start,
				span_end: passage.span.end,
				role: passage.role,
				role_confidence: passage.role_confidence,
				review_state:
					passage.role_confidence < LOW_CONFIDENCE_REVIEW_THRESHOLD ? 'needs_review' : 'candidate',
				verification_state: 'unverified',
				extractor_version: 'legacy-passage-backfill-v1'
			}
		);
		const createdId = Array.isArray(result?.[0]) ? result[0][0]?.id : null;
		if (!createdId) continue;
		created.push({
			id: createdId,
			order_in_source: passage.order_in_source,
			section_title: passage.section_title,
			span_start: passage.span.start,
			span_end: passage.span.end,
			role: passage.role
		});
	}

	return created;
}

async function backfillClaims(
	db: Surreal,
	source: LegacySource,
	passages: PassageRow[],
	sourceText: string,
	dryRun: boolean
): Promise<Map<string, string>> {
	const sidPart = sourceIdPart(source.id);
	const claims = (await db.query<ClaimRow[][]>(
		`SELECT
			id,text,position_in_source,section_context,source_span_start,source_span_end,passage,passage_order,passage_role,
			claim_origin,claim_scope,review_state,verification_state
		FROM claim
		WHERE source = type::thing('source', $sid_part)
		ORDER BY position_in_source ASC`,
		{ sid_part: sidPart }
	))?.[0] ?? [];
	const claimPassageMap = new Map<string, string>();
	for (let index = 0; index < claims.length; index += 1) {
		const claim = claims[index]!;
		const chosen = findMatchingPassage(claim, index, claims.length, passages, sourceText);
		claimPassageMap.set(claim.id, chosen.id);
		if (dryRun) continue;
		await db.query(
			`UPDATE $cid SET
				passage = $passage,
				passage_order = $passage_order,
				passage_role = $passage_role,
				source_span_start = $source_span_start,
				source_span_end = $source_span_end,
				claim_origin = $claim_origin,
				claim_scope = $claim_scope,
				review_state = $review_state,
				verification_state = $verification_state`,
			{
				cid: claim.id,
				passage: chosen.id,
				passage_order: chosen.order_in_source,
				passage_role: chosen.role,
				source_span_start: chosen.span_start,
				source_span_end: chosen.span_end,
				claim_origin: claim.claim_origin || 'source_grounded',
				claim_scope: claim.claim_scope || 'descriptive',
				review_state: claim.review_state || 'candidate',
				verification_state: claim.verification_state || 'unverified'
			}
		);
	}
	return claimPassageMap;
}

async function backfillRelationEvidence(
	db: Surreal,
	source: LegacySource,
	claimPassageMap: Map<string, string>,
	dryRun: boolean
): Promise<number> {
	const claimIds = Array.from(claimPassageMap.keys());
	if (claimIds.length === 0) return 0;

	let updates = 0;
	for (const table of RELATION_TABLES) {
		const rows = (await db.query<RelationRow[][]>(
			`SELECT id,in,out,evidence_passages FROM ${table} WHERE in INSIDE $claim_ids OR out INSIDE $claim_ids`,
			{ claim_ids: claimIds }
		))?.[0] ?? [];
		for (const row of rows) {
			const existingEvidence = Array.isArray(row.evidence_passages) ? row.evidence_passages : [];
			if (existingEvidence.length > 0) continue;
			const evidence = Array.from(
				new Set([
					row.in ? claimPassageMap.get(row.in) : undefined,
					row.out ? claimPassageMap.get(row.out) : undefined
				].filter((value): value is string => Boolean(value)))
			);
			if (evidence.length === 0) continue;
			updates += 1;
			if (dryRun) continue;
			await db.query('UPDATE $rid SET evidence_passages = $evidence', {
				rid: row.id,
				evidence
			});
		}
	}

	return updates;
}

async function main() {
	const { dryRun, force, sourceId, limit } = parseArgs();
	const db = await connectDb();
	const localIndex = buildLocalSourceIndex();
	const allLegacy = await fetchLegacySources(db);
	const filtered = allLegacy
		.filter((source) => (sourceId ? String(source.id) === sourceId : true))
		.slice(0, limit ?? Number.MAX_SAFE_INTEGER);

	console.log(
		`[PASSAGE-BACKFILL] Legacy sources: ${allLegacy.length} | Selected: ${filtered.length} | Dry run: ${dryRun ? 'yes' : 'no'}`
	);

	let completed = 0;
	let skippedNoLocalText = 0;
	let skippedExistingPassages = 0;
	let claimsUpdatedTotal = 0;
	let relationsUpdatedTotal = 0;
	let passagesCreatedTotal = 0;

	for (const source of filtered) {
		const sid = sourceRecordId(source.id);
		const sidPart = sourceIdPart(sid);
		const localTextPath = resolveLocalTextPath(source, localIndex);
		if (!localTextPath) {
			skippedNoLocalText += 1;
			console.log(`[SKIP] ${sid} "${source.title ?? ''}" -> no local source text file`);
			continue;
		}

		const existingPassages = (await db.query<any[][]>(`SELECT id FROM passage WHERE source = type::thing('source', $sid_part) LIMIT 1`, {
			sid_part: sidPart
		}))?.[0] ?? [];
		if (existingPassages.length > 0 && !force) {
			skippedExistingPassages += 1;
			console.log(`[SKIP] ${sid} "${source.title ?? ''}" -> already has passages`);
			continue;
		}

		console.log(`[RUN] ${sid} "${source.title ?? ''}"`);
		const sourceText = fs.readFileSync(localTextPath, 'utf-8');
		const passages = await createPassages(db, source, sourceText, dryRun);
		if (passages.length === 0) {
			console.log(`  [WARN] No passages generated from ${localTextPath}`);
			continue;
		}
		const claimPassageMap = await backfillClaims(db, source, passages, sourceText, dryRun);
		const relationUpdates = await backfillRelationEvidence(db, source, claimPassageMap, dryRun);

		completed += 1;
		passagesCreatedTotal += passages.length;
		claimsUpdatedTotal += claimPassageMap.size;
		relationsUpdatedTotal += relationUpdates;
		console.log(
			`  [OK] passages=${passages.length} claims_linked=${claimPassageMap.size} relation_evidence_updated=${relationUpdates}`
		);
	}

	console.log('[PASSAGE-BACKFILL] Complete');
	console.log(
		`[PASSAGE-BACKFILL] completed=${completed} skipped_no_text=${skippedNoLocalText} skipped_existing=${skippedExistingPassages}`
	);
	console.log(
		`[PASSAGE-BACKFILL] passages_created=${passagesCreatedTotal} claims_linked=${claimsUpdatedTotal} relation_evidence_updated=${relationsUpdatedTotal}`
	);

	await db.close();
}

main().catch((error) => {
	console.error('[PASSAGE-BACKFILL] Fatal:', error);
	process.exit(1);
});
