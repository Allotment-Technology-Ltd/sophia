/**
 * Pick Project Gutenberg book URLs likely to be philosophy.
 *
 * Uses the public Gutendex index to find candidate books, then filters on subject/bookshelf
 * tags containing "Philosophy" or adjacent signals. Optional `domain` narrows Gutendex search
 * and keyword matching (see `gutenbergPhilosophyDomains.ts`).
 */

import {
	type GutenbergPhilosophyDomainId,
	DEFAULT_GUTENBERG_PHILOSOPHY_DOMAIN,
	getGutenbergPhilosophyDomainSpec,
	isGutenbergPhilosophyDomainId
} from '$lib/admin/gutenbergPhilosophyDomains';
import { query } from '$lib/server/db';
import { getDrizzleDb } from '$lib/server/db/neon';
import { ingestRuns, ingestionJobItems } from '$lib/server/db/schema';
import { isNeonIngestPersistenceEnabled } from '$lib/server/neon/datastore';
import { canonicalizeSourceUrl } from '$lib/server/sourceIdentity';
import { eq } from 'drizzle-orm';

type GutendexBook = {
	id: number;
	title?: string;
	authors?: Array<{ name?: string }>;
	bookshelves?: string[];
	subjects?: string[];
	formats?: Record<string, string>;
	download_count?: number;
	languages?: string[];
};

type GutendexPage = {
	next?: string | null;
	results?: GutendexBook[];
};

function normalizeTagList(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.map((s) => String(s ?? '').trim()).filter(Boolean);
}

function hasPhilosophySignal(book: GutendexBook): boolean {
	const tags = [
		...normalizeTagList(book.subjects),
		...normalizeTagList(book.bookshelves),
		...(book.title ? [book.title] : [])
	].map((s) => s.toLowerCase());

	if (tags.some((t) => t.includes('philosophy') || t.includes('philosophical'))) return true;
	// Nearby shelves/subjects that are typically philosophical works in Gutenberg metadata.
	const adjacent = [
		'ethics',
		'metaphysics',
		'metaphys',
		'epistemology',
		'logic',
		'stoicism',
		'skepticism'
	];
	if (tags.some((t) => adjacent.some((k) => t.includes(k)))) return true;
	return false;
}

function bookMetadataBlob(book: GutendexBook): string {
	return [
		book.title ?? '',
		...normalizeTagList(book.subjects),
		...normalizeTagList(book.bookshelves)
	]
		.join(' ')
		.toLowerCase();
}

/** Exported for unit tests. */
export function bookMatchesPhilosophyDomain(
	book: GutendexBook,
	domain: GutenbergPhilosophyDomainId
): boolean {
	if (!hasPlainTextFormat(book)) return false;
	if (domain === DEFAULT_GUTENBERG_PHILOSOPHY_DOMAIN) {
		return hasPhilosophySignal(book);
	}
	const spec = getGutenbergPhilosophyDomainSpec(domain);
	const blob = bookMetadataBlob(book);
	const domainHit =
		spec.domainKeywords.length > 0 &&
		spec.domainKeywords.some((k) => blob.includes(k.toLowerCase()));
	const philosophyish = hasPhilosophySignal(book) || blob.includes('philosoph');
	return domainHit && philosophyish;
}

function gutendexFirstPageUrl(search: string): string {
	const params = new URLSearchParams({ languages: 'en', search: search.trim() || 'philosophy' });
	return `https://gutendex.com/books/?${params.toString()}`;
}

function hasPlainTextFormat(book: GutendexBook): boolean {
	const formats = book.formats ?? {};
	return Object.keys(formats).some((k) => k.toLowerCase().startsWith('text/plain'));
}

function gutenbergEbookUrl(id: number): string {
	return `https://www.gutenberg.org/ebooks/${id}`;
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
		console.warn('[gutenbergPhilosophyBatchPick] Surreal ingestion_log exclude failed:', e);
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
	for (const u of await loadIngestedUrlsFromSurrealIngestionLog()) out.add(u);
	return out;
}

async function fetchGutendex(url: string): Promise<GutendexPage> {
	const res = await fetch(url, {
		method: 'GET',
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Gutendex request failed: ${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 240)}` : ''}`);
	}
	return (await res.json()) as GutendexPage;
}

export type PickGutenbergUrlsArgs = {
	limit: number;
	excludeIngested: boolean;
	/** Narrow retrieval to a philosophical domain (Gutendex search + keyword filter). */
	domain?: GutenbergPhilosophyDomainId;
};

export type PickGutenbergUrlsResult = {
	urls: string[];
	stats: {
		domain: GutenbergPhilosophyDomainId;
		fetchedBooks: number;
		keptPhilosophy: number;
		excludedIngested: number;
		returned: number;
	};
};

export async function pickGutenbergPhilosophyUrlsForBatch(
	args: PickGutenbergUrlsArgs
): Promise<PickGutenbergUrlsResult> {
	const limit = Math.max(1, Math.min(200, Math.trunc(args.limit) || 10));
	const domain: GutenbergPhilosophyDomainId =
		args.domain && isGutenbergPhilosophyDomainId(args.domain) ? args.domain : DEFAULT_GUTENBERG_PHILOSOPHY_DOMAIN;
	const domainSpec = getGutenbergPhilosophyDomainSpec(domain);
	if (
		args.excludeIngested &&
		!isNeonIngestPersistenceEnabled() &&
		!process.env.SURREAL_URL?.trim()
	) {
		throw new Error(
			'Excluding already-ingested URLs needs Neon (DATABASE_URL) and/or SURREAL_URL for ingestion_log. Turn off “Exclude already ingested” or set one of these.'
		);
	}

	const ingested = args.excludeIngested ? await loadIngestedUrlSet() : new Set<string>();

	const seen = new Set<number>();
	const candidates: GutendexBook[] = [];
	let fetchedBooks = 0;

	// Fetch multiple pages until we have enough candidates (cap pages to avoid over-fetch).
	let nextUrl: string | null = gutendexFirstPageUrl(domainSpec.gutendexSearch);
	for (let page = 0; page < 8 && nextUrl && candidates.length < limit * 4; page++) {
		const body = await fetchGutendex(nextUrl);
		const results = Array.isArray(body.results) ? body.results : [];
		for (const book of results) {
			if (!book || typeof book.id !== 'number') continue;
			if (seen.has(book.id)) continue;
			seen.add(book.id);
			fetchedBooks += 1;
			if (!bookMatchesPhilosophyDomain(book, domain)) continue;
			candidates.push(book);
		}
		nextUrl = typeof body.next === 'string' ? body.next : null;
	}

	// Stable sort: higher download_count first, then id for determinism.
	candidates.sort((a, b) => (b.download_count ?? 0) - (a.download_count ?? 0) || a.id - b.id);

	let excludedIngested = 0;
	const urls: string[] = [];
	for (const book of candidates) {
		if (urls.length >= limit) break;
		const u = gutenbergEbookUrl(book.id);
		if (args.excludeIngested) {
			const c = canonicalizeSourceUrl(u);
			if (c && ingested.has(c)) {
				excludedIngested += 1;
				continue;
			}
		}
		urls.push(u);
	}

	return {
		urls,
		stats: {
			domain,
			fetchedBooks,
			keptPhilosophy: candidates.length,
			excludedIngested,
			returned: urls.length
		}
	};
}

