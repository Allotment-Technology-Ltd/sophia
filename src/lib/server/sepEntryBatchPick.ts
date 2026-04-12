/**
 * Pick SEP entry URLs from the repo catalog by topic keywords / presets,
 * optionally excluding URLs already completed in Neon (ingest_runs + durable job items)
 * and/or Surreal `ingestion_log` (status `complete`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { query } from '$lib/server/db';
import { canonicalizeSourceUrl } from '$lib/server/sourceIdentity';
import { getDrizzleDb } from '$lib/server/db/neon';
import { ingestRuns, ingestionJobItems } from '$lib/server/db/schema';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';

export type SepTopicPresetMeta = { id: string; label: string };

type PresetsFile = {
	version: number;
	presets: Array<{
		id: string;
		label: string;
		slugContainsAny: string[];
	}>;
};

let cachedCatalog: { urls: string[]; loadedAt: number } | null = null;
let cachedPresets: PresetsFile | null = null;
const CACHE_MS = 60_000;

function repoDataPath(...segments: string[]): string {
	return join(process.cwd(), 'data', ...segments);
}

/** Stanford Encyclopedia of Philosophy public site (HTTPS). */
const SEP_CATALOG_HOST = 'plato.stanford.edu';

function isSepCatalogHttpsUrl(u: string): boolean {
	try {
		const parsed = new URL(u.trim());
		if (parsed.protocol !== 'https:') return false;
		// Host must match exactly; no substring tricks (e.g. evil.plato.stanford.edu.evil.com).
		return parsed.hostname === SEP_CATALOG_HOST;
	} catch {
		return false;
	}
}

function loadSepCatalogUrls(): string[] {
	const now = Date.now();
	if (cachedCatalog && now - cachedCatalog.loadedAt < CACHE_MS) {
		return cachedCatalog.urls;
	}
	const raw = readFileSync(repoDataPath('sep-entry-urls.json'), 'utf-8');
	const parsed = JSON.parse(raw) as { urls?: unknown };
	const urls = Array.isArray(parsed.urls)
		? parsed.urls.filter((u): u is string => typeof u === 'string' && isSepCatalogHttpsUrl(u))
		: [];
	cachedCatalog = { urls, loadedAt: now };
	return urls;
}

function loadPresetsFile(): PresetsFile {
	if (cachedPresets) return cachedPresets;
	const raw = readFileSync(repoDataPath('sep-topic-presets.json'), 'utf-8');
	cachedPresets = JSON.parse(raw) as PresetsFile;
	return cachedPresets;
}

export function listSepTopicPresets(): SepTopicPresetMeta[] {
	const f = loadPresetsFile();
	return f.presets.map((p) => ({ id: p.id, label: p.label }));
}

/** Preset ids from `data/sep-topic-presets.json` whose keywords match this catalog URL’s entry slug. */
export function getSepEntryTopicPresetMatches(url: string): string[] {
	const slug = entrySlugFromSepUrl(url);
	if (!slug) return [];
	const presets = loadPresetsFile();
	const out: string[] = [];
	for (const p of presets.presets) {
		if (slugMatchesKeywords(slug, p.slugContainsAny)) out.push(p.id);
	}
	return out;
}

function entrySlugFromSepUrl(url: string): string | null {
	try {
		const u = new URL(url.trim());
		const m = u.pathname.match(/\/entries\/([^/]+)/);
		return m?.[1] ? m[1].toLowerCase() : null;
	} catch {
		return null;
	}
}

function slugMatchesKeywords(slug: string, keywords: string[]): boolean {
	if (keywords.length === 0) return false;
	const s = slug.toLowerCase();
	return keywords.some((k) => {
		const t = k.trim().toLowerCase();
		return t.length > 0 && s.includes(t);
	});
}

async function loadIngestedUrlsFromSurrealIngestionLog(): Promise<Set<string>> {
	const out = new Set<string>();
	if (!process.env.SURREAL_URL?.trim()) return out;
	try {
		const rows = await query<Array<{ source_url?: string; canonical_url?: string }>>(
			`SELECT source_url, canonical_url FROM ingestion_log WHERE status = 'complete';`,
			{}
		);
		if (!Array.isArray(rows)) return out;
		for (const r of rows) {
			for (const u of [r.source_url, r.canonical_url]) {
				if (typeof u === 'string' && u.trim()) {
					const c = canonicalizeSourceUrl(u);
					if (c) out.add(c);
				}
			}
		}
	} catch (e) {
		console.warn('[sepEntryBatchPick] Surreal ingestion_log exclude failed:', e);
	}
	return out;
}

async function loadIngestedUrlSet(): Promise<Set<string>> {
	const out = new Set<string>();

	if (isNeonIngestPersistenceEnabled()) {
		const db = getDrizzleDb();

		const runs = await db
			.select({ sourceUrl: ingestRuns.sourceUrl })
			.from(ingestRuns)
			.where(eq(ingestRuns.status, 'done'));
		for (const r of runs) {
			const c = canonicalizeSourceUrl(r.sourceUrl);
			if (c) out.add(c);
		}

		const suppressed = await db
			.select({ sourceUrl: ingestRuns.sourceUrl })
			.from(ingestRuns)
			.where(eq(ingestRuns.excludeFromBatchSuggest, true));
		for (const r of suppressed) {
			const c = canonicalizeSourceUrl(r.sourceUrl);
			if (c) out.add(c);
		}

		const items = await db
			.select({ url: ingestionJobItems.url })
			.from(ingestionJobItems)
			.where(eq(ingestionJobItems.status, 'done'));
		for (const r of items) {
			const c = canonicalizeSourceUrl(r.url);
			if (c) out.add(c);
		}
	}

	for (const u of await loadIngestedUrlsFromSurrealIngestionLog()) {
		out.add(u);
	}

	return out;
}

export type PickSepUrlsArgs = {
	presetId?: string | null;
	/** Extra keywords (comma- or space-separated); OR-matched against slug with preset keywords. */
	customKeywords?: string | null;
	limit: number;
	excludeIngested: boolean;
};

export type PickSepUrlsResult = {
	urls: string[];
	stats: {
		catalogSize: number;
		matchedBeforeExclude: number;
		excludedIngested: number;
		returned: number;
		keywordsUsed: string[];
	};
};

function parseCustomKeywords(raw: string | null | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(/[,;\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export async function pickSepEntryUrlsForBatch(args: PickSepUrlsArgs): Promise<PickSepUrlsResult> {
	if (
		args.excludeIngested &&
		!isNeonIngestPersistenceEnabled() &&
		!process.env.SURREAL_URL?.trim()
	) {
		throw new Error(
			'Excluding already-ingested URLs needs Neon (DATABASE_URL) and/or SURREAL_URL for ingestion_log. Turn off “Exclude already ingested” or set one of these.'
		);
	}
	const catalog = loadSepCatalogUrls();
	const presets = loadPresetsFile();
	const limit = Math.max(1, Math.min(200, Math.trunc(args.limit) || 10));

	let keywords: string[] = [];
	const presetId = args.presetId?.trim() ?? '';
	if (presetId) {
		const p = presets.presets.find((x) => x.id === presetId);
		if (!p) {
			throw new Error(`Unknown topic preset "${presetId}".`);
		}
		keywords = [...p.slugContainsAny];
	}
	keywords = [...keywords, ...parseCustomKeywords(args.customKeywords)];
	if (keywords.length === 0) {
		throw new Error('Choose a topic preset and/or add custom keywords (slug substrings).');
	}

	const matched: string[] = [];
	for (const url of catalog) {
		const slug = entrySlugFromSepUrl(url);
		if (!slug) continue;
		if (slugMatchesKeywords(slug, keywords)) {
			matched.push(url);
		}
	}
	matched.sort((a, b) => a.localeCompare(b));

	let excludedIngested = 0;
	let candidates = matched;
	if (args.excludeIngested) {
		const ingested = await loadIngestedUrlSet();
		const next: string[] = [];
		for (const url of matched) {
			const c = canonicalizeSourceUrl(url);
			if (c && ingested.has(c)) {
				excludedIngested += 1;
				continue;
			}
			next.push(url);
		}
		candidates = next;
	}

	const urls = candidates.slice(0, limit);

	return {
		urls,
		stats: {
			catalogSize: catalog.length,
			matchedBeforeExclude: matched.length,
			excludedIngested,
			returned: urls.length,
			keywordsUsed: keywords
		}
	};
}
