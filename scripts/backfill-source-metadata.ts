import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');

interface SourceListEntry {
	id?: number;
	title?: string;
	author?: string[];
	year?: number | null;
	url: string;
	source_type?: string;
	priority?: string;
	subdomain?: string;
	wave?: number;
	domain?: string;
	notes?: string;
}

interface SourceMetaRecord {
	title?: string;
	author?: string[];
	year?: number | null;
	source_type?: string;
	url?: string;
	canonical_url?: string;
	canonical_url_hash?: string;
	visibility_scope?: string;
	deletion_state?: string;
	fetched_at?: string;
	word_count?: number;
	char_count?: number;
	estimated_tokens?: number;
	local_slug?: string;
	[key: string]: unknown;
}

function listSourceListFiles(): string[] {
	return fs
		.readdirSync(DATA_DIR)
		.filter((file) => file.startsWith('source-list') && file.endsWith('.json'))
		.sort();
}

function loadSourceListIndex(): Map<string, SourceListEntry> {
	const index = new Map<string, SourceListEntry>();

	for (const file of listSourceListFiles()) {
		const filePath = path.join(DATA_DIR, file);
		const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SourceListEntry[];
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

function estimateTokens(text: string): number {
	const words = text.trim() ? text.trim().split(/\s+/).length : 0;
	return Math.ceil(words * 1.3);
}

function shouldReplaceTitle(title: unknown): boolean {
	if (typeof title !== 'string') return true;
	const normalized = title.trim().toLowerCase();
	return !normalized || normalized === 'unknown title' || normalized === 'unknown';
}

function normalizeAuthor(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
		.filter(Boolean);
}

function orderedMeta(record: SourceMetaRecord): SourceMetaRecord {
	const ordered: SourceMetaRecord = {
		title: record.title,
		author: normalizeAuthor(record.author),
		source_type: record.source_type,
		url: record.url,
		canonical_url: record.canonical_url,
		canonical_url_hash: record.canonical_url_hash,
		visibility_scope: record.visibility_scope,
		deletion_state: record.deletion_state,
		fetched_at: record.fetched_at,
		word_count: record.word_count,
		char_count: record.char_count,
		estimated_tokens: record.estimated_tokens,
		local_slug: record.local_slug
	};

	if (typeof record.year === 'number' || record.year === null) {
		ordered.year = record.year;
	}

	for (const [key, value] of Object.entries(record)) {
		if (key in ordered) continue;
		ordered[key] = value;
	}

	return ordered;
}

function backfillMetaFile(filePath: string, sourceListIndex: Map<string, SourceListEntry>, dryRun: boolean) {
	const meta = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SourceMetaRecord;
	const localSlug = path.basename(filePath, '.meta.json');
	const txtPath = path.join(SOURCES_DIR, `${localSlug}.txt`);

	if (!meta.url || typeof meta.url !== 'string') {
		throw new Error(`metadata missing url`);
	}

	const identity = canonicalizeAndHashSourceUrl(meta.canonical_url || meta.url);
	if (!identity) {
		throw new Error(`url cannot be canonicalized: ${meta.url}`);
	}

	const sourceListMatch = sourceListIndex.get(identity.canonicalUrlHash);
	const next: SourceMetaRecord = { ...meta };

	next.url = identity.canonicalUrl;
	next.canonical_url = identity.canonicalUrl;
	next.canonical_url_hash = identity.canonicalUrlHash;
	next.visibility_scope = next.visibility_scope || 'public_shared';
	next.deletion_state = next.deletion_state || 'active';
	next.local_slug = localSlug;

	if (shouldReplaceTitle(next.title) && sourceListMatch?.title) {
		next.title = sourceListMatch.title;
	}
	if (normalizeAuthor(next.author).length === 0 && Array.isArray(sourceListMatch?.author)) {
		next.author = sourceListMatch.author;
	}
	if ((next.year === undefined || next.year === null) && typeof sourceListMatch?.year === 'number') {
		next.year = sourceListMatch.year;
	}
	if (!next.source_type && sourceListMatch?.source_type) {
		next.source_type = sourceListMatch.source_type;
	}

	if (fs.existsSync(txtPath)) {
		const text = fs.readFileSync(txtPath, 'utf-8');
		if (!Number.isFinite(next.word_count) || (next.word_count ?? 0) <= 0) {
			next.word_count = text.trim() ? text.trim().split(/\s+/).length : 0;
		}
		if (!Number.isFinite(next.char_count) || (next.char_count ?? 0) <= 0) {
			next.char_count = text.length;
		}
		if (!Number.isFinite(next.estimated_tokens) || (next.estimated_tokens ?? 0) <= 0) {
			next.estimated_tokens = estimateTokens(text);
		}
	}

	const nextOrdered = orderedMeta(next);
	const changed = JSON.stringify(meta) !== JSON.stringify(nextOrdered);
	const updated = JSON.stringify(nextOrdered, null, 2) + '\n';

	if (changed && !dryRun) {
		fs.writeFileSync(filePath, updated, 'utf-8');
	}

	return {
		localSlug,
		changed,
		canonicalUrlHash: identity.canonicalUrlHash,
		matchedSourceList: Boolean(sourceListMatch)
	};
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');
	const metaFiles = fs
		.readdirSync(SOURCES_DIR)
		.filter((file) => file.endsWith('.meta.json'))
		.sort()
		.map((file) => path.join(SOURCES_DIR, file));

	if (metaFiles.length === 0) {
		throw new Error(`no metadata files found in ${SOURCES_DIR}`);
	}

	const sourceListIndex = loadSourceListIndex();
	let changed = 0;
	let unchanged = 0;
	let matched = 0;
	const errors: string[] = [];

	for (const filePath of metaFiles) {
		try {
			const result = backfillMetaFile(filePath, sourceListIndex, dryRun);
			if (result.changed) changed++;
			else unchanged++;
			if (result.matchedSourceList) matched++;
			console.log(
				`[BACKFILL] ${result.changed ? 'updated' : 'ok'} ${path.basename(filePath)} -> ${result.canonicalUrlHash.slice(0, 12)}`
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`${path.basename(filePath)}: ${message}`);
			console.error(`[BACKFILL] error ${path.basename(filePath)}: ${message}`);
		}
	}

	console.log('\n[BACKFILL] Summary');
	console.log(`  files scanned      : ${metaFiles.length}`);
	console.log(`  files changed      : ${changed}`);
	console.log(`  files unchanged    : ${unchanged}`);
	console.log(`  source-list matches: ${matched}`);
	console.log(`  mode               : ${dryRun ? 'dry-run' : 'write'}`);

	if (errors.length > 0) {
		console.log(`  errors             : ${errors.length}`);
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error('[BACKFILL] Fatal error:', error);
	process.exit(1);
});
