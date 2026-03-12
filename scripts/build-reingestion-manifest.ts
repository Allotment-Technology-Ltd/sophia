import * as fs from 'node:fs';
import * as path from 'node:path';
import { Surreal } from 'surrealdb';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const OUTPUT_PATH = path.join(DATA_DIR, 'reingestion-manifest.json');

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const SEP_PILOT_URL = 'https://plato.stanford.edu/entries/identity-ethics';
const GUTENBERG_PILOT_URL = 'https://www.gutenberg.org/files/5682/5682-h/5682-h.htm';

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
}

interface LocalArtifact {
	canonical_url: string;
	local_slug: string;
	meta_path: string;
	text_path: string;
	text_exists: boolean;
	text_bytes: number;
	title: string | null;
	author: string[];
	year: number | null;
	source_type: string | null;
	fetched_at: string | null;
	word_count: number | null;
	char_count: number | null;
	estimated_tokens: number | null;
}

interface DbSourceRow {
	id: string;
	title?: string;
	url?: string | null;
	canonical_url?: string | null;
	canonical_url_hash?: string | null;
	status?: string | null;
	claim_count?: number | null;
	ingested_at?: string | null;
}

interface IngestionLogRow {
	source_url: string;
	source_title?: string | null;
	status?: string | null;
	stage_completed?: string | null;
	error_message?: string | null;
	claims_extracted?: number | null;
	relations_extracted?: number | null;
	arguments_grouped?: number | null;
	cost_usd?: number | null;
	started_at?: string | null;
	completed_at?: string | null;
}

function listSourceListFiles(): string[] {
	return fs
		.readdirSync(DATA_DIR)
		.filter((file) => file.startsWith('source-list') && file.endsWith('.json'))
		.sort();
}

function normalizeAuthors(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
		.filter(Boolean);
}

function readLocalArtifacts(): Map<string, LocalArtifact[]> {
	const grouped = new Map<string, LocalArtifact[]>();
	const metaFiles = fs
		.readdirSync(SOURCES_DIR)
		.filter((file) => file.endsWith('.meta.json'))
		.sort();

	for (const file of metaFiles) {
		const metaPath = path.join(SOURCES_DIR, file);
		const localSlug = path.basename(file, '.meta.json');
		const textPath = path.join(SOURCES_DIR, `${localSlug}.txt`);
		const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SourceMetaRecord;
		const identity = canonicalizeAndHashSourceUrl(meta.canonical_url || meta.url || '');
		if (!identity) continue;

		const textExists = fs.existsSync(textPath);
		const textBytes = textExists ? fs.statSync(textPath).size : 0;
		const artifact: LocalArtifact = {
			canonical_url: identity.canonicalUrl,
			local_slug: localSlug,
			meta_path: path.relative(process.cwd(), metaPath),
			text_path: path.relative(process.cwd(), textPath),
			text_exists: textExists,
			text_bytes: textBytes,
			title: typeof meta.title === 'string' ? meta.title : null,
			author: normalizeAuthors(meta.author),
			year: typeof meta.year === 'number' ? meta.year : null,
			source_type: typeof meta.source_type === 'string' ? meta.source_type : null,
			fetched_at: typeof meta.fetched_at === 'string' ? meta.fetched_at : null,
			word_count: Number.isFinite(meta.word_count) ? Number(meta.word_count) : null,
			char_count: Number.isFinite(meta.char_count) ? Number(meta.char_count) : null,
			estimated_tokens: Number.isFinite(meta.estimated_tokens) ? Number(meta.estimated_tokens) : null
		};

		const artifacts = grouped.get(identity.canonicalUrlHash) ?? [];
		artifacts.push(artifact);
		grouped.set(identity.canonicalUrlHash, artifacts);
	}

	return grouped;
}

function choosePrimaryArtifact(artifacts: LocalArtifact[]): LocalArtifact {
	return [...artifacts].sort((left, right) => {
		const leftScore = Number(left.text_exists && left.text_bytes > 0);
		const rightScore = Number(right.text_exists && right.text_bytes > 0);
		if (leftScore !== rightScore) return rightScore - leftScore;
		if ((left.word_count ?? 0) !== (right.word_count ?? 0)) {
			return (right.word_count ?? 0) - (left.word_count ?? 0);
		}
		return (right.fetched_at ?? '').localeCompare(left.fetched_at ?? '');
	})[0]!;
}

function loadSourceListIndex(): Map<string, Array<SourceListEntry & { source_list_file: string }>> {
	const index = new Map<string, Array<SourceListEntry & { source_list_file: string }>>();

	for (const file of listSourceListFiles()) {
		const filePath = path.join(DATA_DIR, file);
		const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SourceListEntry[];
		for (const entry of entries) {
			const identity = canonicalizeAndHashSourceUrl(entry.url);
			if (!identity) continue;
			const rows = index.get(identity.canonicalUrlHash) ?? [];
			rows.push({ ...entry, source_list_file: path.relative(process.cwd(), filePath) });
			index.set(identity.canonicalUrlHash, rows);
		}
	}

	return index;
}

async function loadDbSourceIndex() {
	const db = new Surreal();
	try {
		await db.connect(SURREAL_URL);
		await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
		await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });

		const sourcesResult = await db.query<DbSourceRow[][]>(
			`SELECT id, title, url, canonical_url, canonical_url_hash, status, claim_count, ingested_at FROM source`
		);
		const logsResult = await db.query<IngestionLogRow[][]>(
			`SELECT source_url, source_title, status, stage_completed, error_message, claims_extracted, relations_extracted, arguments_grouped, cost_usd, started_at, completed_at FROM ingestion_log`
		);

		const sourceRows = Array.isArray(sourcesResult?.[0]) ? sourcesResult[0] : [];
		const logRows = Array.isArray(logsResult?.[0]) ? logsResult[0] : [];

		const sourcesByHash = new Map<string, DbSourceRow>();
		for (const row of sourceRows) {
			const identity = canonicalizeAndHashSourceUrl(row.canonical_url || row.url || '');
			if (!identity) continue;
			sourcesByHash.set(identity.canonicalUrlHash, row);
		}

		const logsByHash = new Map<string, IngestionLogRow>();
		for (const row of logRows) {
			const identity = canonicalizeAndHashSourceUrl(row.source_url || '');
			if (!identity) continue;
			logsByHash.set(identity.canonicalUrlHash, row);
		}

		await db.close();
		return { connected: true as const, sourcesByHash, logsByHash };
	} catch (error) {
		await db.close().catch(() => undefined);
		return {
			connected: false as const,
			error: error instanceof Error ? error.message : String(error),
			sourcesByHash: new Map<string, DbSourceRow>(),
			logsByHash: new Map<string, IngestionLogRow>()
		};
	}
}

function pilotPriority(canonicalUrl: string): string | null {
	if (canonicalUrl === SEP_PILOT_URL) return 'sep_pilot';
	if (canonicalUrl === GUTENBERG_PILOT_URL) return 'gutenberg_pilot';
	return null;
}

async function main() {
	const localArtifactsByHash = readLocalArtifacts();
	const sourceListIndex = loadSourceListIndex();
	const dbIndex = await loadDbSourceIndex();

	const manifest: Record<string, unknown> = {
		generated_at: new Date().toISOString(),
		generated_by: 'scripts/build-reingestion-manifest.ts',
		db_enrichment: dbIndex.connected
			? { connected: true }
			: { connected: false, error: dbIndex.error },
		sources_by_canonical_url_hash: {} as Record<string, unknown>
	};

	const entries: Record<string, unknown> = {};

	for (const [canonicalUrlHash, artifacts] of [...localArtifactsByHash.entries()].sort((a, b) =>
		a[0].localeCompare(b[0])
	)) {
		const primaryArtifact = choosePrimaryArtifact(artifacts);
		const sourceListEntries = (sourceListIndex.get(canonicalUrlHash) ?? []).map((entry) => ({
			source_list_file: entry.source_list_file,
			id: entry.id ?? null,
			title: entry.title ?? null,
			author: entry.author ?? [],
			year: entry.year ?? null,
			url: entry.url,
			source_type: entry.source_type ?? null,
			priority: entry.priority ?? null,
			subdomain: entry.subdomain ?? null,
			wave: entry.wave ?? null,
			domain: entry.domain ?? null,
			notes: entry.notes ?? null
		}));

		const primarySourceList = sourceListEntries[0];
		const notes: string[] = [];
		const blockingReasons: string[] = [];

		if (!primaryArtifact.text_exists || primaryArtifact.text_bytes === 0) {
			blockingReasons.push('missing_or_empty_local_text');
		}
		if ((primaryArtifact.word_count ?? 0) <= 1) {
			blockingReasons.push('insufficient_word_count');
		}
		if (artifacts.length > 1) {
			notes.push(`duplicate_local_artifacts:${artifacts.length}`);
		}
		if (
			primarySourceList?.title &&
			primaryArtifact.title &&
			primarySourceList.title.trim() !== primaryArtifact.title.trim()
		) {
			notes.push('title_mismatch_between_source_list_and_local_meta');
		}
		if (
			Array.isArray(primarySourceList?.author) &&
			primarySourceList.author.length > 0 &&
			primaryArtifact.author.length > 0 &&
			primarySourceList.author.join('|') !== primaryArtifact.author.join('|')
		) {
			notes.push('author_mismatch_between_source_list_and_local_meta');
		}

		const canonicalUrl =
			canonicalizeAndHashSourceUrl(
				dbIndex.sourcesByHash.get(canonicalUrlHash)?.canonical_url ||
					dbIndex.sourcesByHash.get(canonicalUrlHash)?.url ||
					sourceListEntries[0]?.url ||
					primaryArtifact.canonical_url ||
					''
			)?.canonicalUrl ?? null;

		entries[canonicalUrlHash] = {
			canonical_url_hash: canonicalUrlHash,
			canonical_url: canonicalUrl,
			pilot_priority: canonicalUrl ? pilotPriority(canonicalUrl) : null,
			reingestion_status: blockingReasons.length > 0 ? 'blocked' : 'ready_for_reingest',
			blocking_reasons: blockingReasons,
			notes,
			preferred_title: primarySourceList?.title ?? primaryArtifact.title,
			preferred_author: primarySourceList?.author ?? primaryArtifact.author,
			preferred_year: primarySourceList?.year ?? primaryArtifact.year,
			source_type: primarySourceList?.source_type ?? primaryArtifact.source_type,
			primary_local_artifact: primaryArtifact,
			local_artifacts: artifacts,
			source_list_entries: sourceListEntries,
			db_source: dbIndex.sourcesByHash.get(canonicalUrlHash) ?? null,
			db_ingestion_log: dbIndex.logsByHash.get(canonicalUrlHash) ?? null
		};
	}

	manifest.sources_by_canonical_url_hash = entries;
	fs.writeFileSync(OUTPUT_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

	console.log(`[MANIFEST] wrote ${OUTPUT_PATH}`);
	console.log(`[MANIFEST] source identities: ${Object.keys(entries).length}`);
	if (!dbIndex.connected) {
		console.log(`[MANIFEST] db enrichment unavailable: ${dbIndex.error}`);
	}
}

main().catch((error) => {
	console.error('[MANIFEST] Fatal error:', error);
	process.exit(1);
});
