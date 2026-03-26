import fs from 'node:fs';
import path from 'node:path';
import { Surreal } from 'surrealdb';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.js';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const VALID_SOURCE_TYPES = new Set(['sep_entry', 'iep_entry', 'book', 'paper', 'institutional']);

type SourceRow = {
	id: string;
	title?: string;
	author?: string[];
	year?: number | null;
	source_type?: string;
	url?: string;
	canonical_url?: string;
	canonical_url_hash?: string;
	visibility_scope?: string;
	deletion_state?: string;
};

type SourceListEntry = {
	title?: string;
	author?: string[];
	year?: number | null;
	url: string;
	source_type?: string;
};

type SourceMetaRecord = {
	title?: string;
	author?: string[];
	year?: number | null;
	source_type?: string;
	url?: string;
	canonical_url?: string;
	canonical_url_hash?: string;
};

type Patch = Record<string, unknown>;

function sourceIdPart(id: unknown): string {
	const raw = String(id ?? '');
	if (!raw.includes(':')) return raw;
	return raw.split(':').slice(1).join(':');
}

function readArg(args: string[], key: string): string | undefined {
	const idx = args.indexOf(key);
	if (idx < 0) return undefined;
	return args[idx + 1];
}

function parseArgs() {
	const args = process.argv.slice(2);
	const dryRun = args.includes('--dry-run');
	const sourceId = readArg(args, '--source-id');
	return { dryRun, sourceId };
}

function normalizeUrl(url?: string | null): string {
	if (!url) return '';
	return url.trim().replace(/\/+$/, '');
}

/** Parse for hostname/path checks without substring false positives on path/query (CodeQL). */
function tryParseHttpUrl(raw: string): URL | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const withProto = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
	try {
		return new URL(withProto);
	} catch {
		return null;
	}
}

function nonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isUnknownTitle(value: unknown): boolean {
	if (typeof value !== 'string') return true;
	const normalized = value.trim().toLowerCase();
	return normalized === '' || normalized === 'unknown title' || normalized === 'unknown';
}

function normalizeAuthorList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => (typeof item === 'string' ? item.trim() : ''))
		.filter(Boolean)
		.filter((item) => !/^(unknown|n\/a|null)$/i.test(item));
}

function needsCitationFix(row: SourceRow): boolean {
	const urlIdentity = canonicalizeAndHashSourceUrl(
		nonEmptyString(row.canonical_url) || nonEmptyString(row.url) || ''
	);
	return (
		isUnknownTitle(row.title) ||
		normalizeAuthorList(row.author).length === 0 ||
		!nonEmptyString(row.source_type) ||
		!nonEmptyString(row.url) ||
		!nonEmptyString(row.canonical_url) ||
		!nonEmptyString(row.canonical_url_hash) ||
		!nonEmptyString(row.visibility_scope) ||
		!nonEmptyString(row.deletion_state) ||
		(Boolean(urlIdentity) &&
			(nonEmptyString(row.url) !== urlIdentity?.canonicalUrl ||
				nonEmptyString(row.canonical_url) !== urlIdentity?.canonicalUrl ||
				nonEmptyString(row.canonical_url_hash) !== urlIdentity?.canonicalUrlHash))
	);
}

function loadSourceListIndex(): Map<string, SourceListEntry> {
	const files = fs
		.readdirSync(DATA_DIR)
		.filter((file) => file.startsWith('source-list') && file.endsWith('.json'))
		.map((file) => path.join(DATA_DIR, file));
	const index = new Map<string, SourceListEntry>();
	for (const file of files) {
		const entries = JSON.parse(fs.readFileSync(file, 'utf-8')) as SourceListEntry[];
		for (const entry of entries) {
			const identity = canonicalizeAndHashSourceUrl(entry.url);
			if (!identity) continue;
			if (!index.has(identity.canonicalUrlHash)) {
				index.set(identity.canonicalUrlHash, entry);
			}
		}
	}
	return index;
}

function loadMetaIndex(): {
	byHash: Map<string, SourceMetaRecord>;
	byUrl: Map<string, SourceMetaRecord>;
} {
	const byHash = new Map<string, SourceMetaRecord>();
	const byUrl = new Map<string, SourceMetaRecord>();
	const metaFiles = fs.readdirSync(SOURCES_DIR).filter((file) => file.endsWith('.meta.json'));
	for (const file of metaFiles) {
		const meta = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, file), 'utf-8')) as SourceMetaRecord;
		if (meta.canonical_url_hash) byHash.set(meta.canonical_url_hash, meta);
		const metaCanonicalUrl = normalizeUrl(meta.canonical_url);
		if (metaCanonicalUrl) byUrl.set(metaCanonicalUrl, meta);
		const metaUrl = normalizeUrl(meta.url);
		if (metaUrl) byUrl.set(metaUrl, meta);
	}
	return { byHash, byUrl };
}

function inferSourceType(url?: string): string {
	const normalized = normalizeUrl(url);
	if (!normalized) return 'paper';
	const parsed = tryParseHttpUrl(normalized);
	if (!parsed) return 'paper';
	const host = parsed.hostname.toLowerCase();
	const path = parsed.pathname.toLowerCase();

	if (host === 'plato.stanford.edu' && path.startsWith('/entries/')) return 'sep_entry';
	if (host === 'iep.utm.edu' || host.endsWith('.iep.utm.edu')) return 'iep_entry';
	if (host === 'gutenberg.org' || host.endsWith('.gutenberg.org')) return 'book';
	if (
		host === 'unesco.org' ||
		host.endsWith('.unesco.org') ||
		host === 'oecd.ai' ||
		host.endsWith('.oecd.ai') ||
		host === 'artificialintelligenceact.eu' ||
		host.endsWith('.artificialintelligenceact.eu')
	) {
		return 'institutional';
	}
	return 'paper';
}

function buildPatch(
	row: SourceRow,
	meta: SourceMetaRecord | undefined,
	sourceList: SourceListEntry | undefined
): Patch {
	const patch: Patch = {};
	const bestUrl =
		meta?.canonical_url ||
		meta?.url ||
		nonEmptyString(row.canonical_url) ||
		nonEmptyString(row.url) ||
		undefined;
	const identity = bestUrl ? canonicalizeAndHashSourceUrl(bestUrl) : null;

	if (identity) {
		if (nonEmptyString(row.url) !== identity.canonicalUrl) patch.url = identity.canonicalUrl;
		if (nonEmptyString(row.canonical_url) !== identity.canonicalUrl) patch.canonical_url = identity.canonicalUrl;
		if (nonEmptyString(row.canonical_url_hash) !== identity.canonicalUrlHash) {
			patch.canonical_url_hash = identity.canonicalUrlHash;
		}
	}

	const nextTitle =
		!isUnknownTitle(row.title) ? row.title : meta?.title || sourceList?.title || row.title || undefined;
	if (nextTitle && nextTitle !== row.title) patch.title = nextTitle;

	const currentAuthors = normalizeAuthorList(row.author);
	const nextAuthors =
		currentAuthors.length > 0
			? currentAuthors
			: normalizeAuthorList(meta?.author).length > 0
				? normalizeAuthorList(meta?.author)
				: normalizeAuthorList(sourceList?.author);
	if (nextAuthors.length > 0 && JSON.stringify(nextAuthors) !== JSON.stringify(currentAuthors)) {
		patch.author = nextAuthors;
	}

	const nextYear =
		typeof row.year === 'number'
			? row.year
			: typeof meta?.year === 'number'
				? meta.year
				: typeof sourceList?.year === 'number'
					? sourceList.year
					: undefined;
	if (typeof nextYear === 'number' && row.year !== nextYear) {
		patch.year = nextYear;
	}

	const typeCandidate = row.source_type || meta?.source_type || sourceList?.source_type || inferSourceType(bestUrl);
	if (typeCandidate && VALID_SOURCE_TYPES.has(typeCandidate) && row.source_type !== typeCandidate) {
		patch.source_type = typeCandidate;
	}

	if (!nonEmptyString(row.visibility_scope)) patch.visibility_scope = 'public_shared';
	if (!nonEmptyString(row.deletion_state)) patch.deletion_state = 'active';

	return patch;
}

async function main() {
	const { dryRun, sourceId } = parseArgs();
	const sourceListIndex = loadSourceListIndex();
	const metaIndex = loadMetaIndex();

	const db = new Surreal();
	await db.connect(SURREAL_URL);
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });

	const rows = (await db.query<SourceRow[][]>(
		'SELECT id,title,author,year,source_type,url,canonical_url,canonical_url_hash,visibility_scope,deletion_state FROM source'
	))?.[0] ?? [];

	let scanned = 0;
	let patched = 0;
	let unresolved = 0;
	const unresolvedRows: Array<{ id: string; title?: string; url?: string; reason: string[] }> = [];

	for (const row of rows) {
		if (sourceId && String(row.id) !== sourceId) continue;
		if (!needsCitationFix(row)) continue;
		scanned += 1;

		const rowCanonical = canonicalizeAndHashSourceUrl(row.canonical_url || row.url || '');
		const metaMatch =
			(rowCanonical?.canonicalUrlHash && metaIndex.byHash.get(rowCanonical.canonicalUrlHash)) ||
			metaIndex.byUrl.get(normalizeUrl(row.url)) ||
			metaIndex.byUrl.get(normalizeUrl(row.canonical_url));
		const sourceListMatch =
			(rowCanonical?.canonicalUrlHash && sourceListIndex.get(rowCanonical.canonicalUrlHash)) || undefined;

		const patch = buildPatch(row, metaMatch, sourceListMatch);
		const changedKeys = Object.keys(patch);
		if (changedKeys.length > 0) {
			patched += 1;
			console.log(`[PATCH] ${row.id} ${row.title ?? '(no title)'} -> ${changedKeys.join(', ')}`);
			if (!dryRun) {
				const idPart = sourceIdPart(row.id);
				await db.query("UPDATE type::thing('source', $idPart) MERGE $patch", { idPart, patch });
			}
		}

		const finalTitle = (patch.title as string | undefined) ?? row.title;
		const finalAuthors = normalizeAuthorList((patch.author as string[] | undefined) ?? row.author);
		const finalUrl = (patch.url as string | undefined) ?? row.url;
		const finalCanonical = (patch.canonical_url as string | undefined) ?? row.canonical_url;
		const finalHash = (patch.canonical_url_hash as string | undefined) ?? row.canonical_url_hash;
		const reasons: string[] = [];
		if (isUnknownTitle(finalTitle)) reasons.push('title_missing_or_unknown');
		if (finalAuthors.length === 0) reasons.push('author_missing');
		if (!finalUrl) reasons.push('url_missing');
		if (!finalCanonical) reasons.push('canonical_url_missing');
		if (!finalHash) reasons.push('canonical_url_hash_missing');
		if (reasons.length > 0) {
			unresolved += 1;
			unresolvedRows.push({ id: row.id, title: finalTitle, url: finalUrl, reason: reasons });
		}
	}

	await db.close();

	console.log('\n[REPAIR] Summary');
	console.log(`  scanned problematic rows: ${scanned}`);
	console.log(`  patched rows           : ${patched}`);
	console.log(`  unresolved rows        : ${unresolved}`);
	console.log(`  mode                   : ${dryRun ? 'dry-run' : 'write'}`);
	if (unresolvedRows.length > 0) {
		console.log('\n[REPAIR] Unresolved');
		for (const row of unresolvedRows) {
			console.log(`  - ${row.id} "${row.title ?? ''}" ${row.url ?? ''} :: ${row.reason.join(',')}`);
		}
	}
}

main().catch((error) => {
	console.error('[REPAIR] Fatal:', error);
	process.exit(1);
});
