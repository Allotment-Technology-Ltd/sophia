/**
 * SOPHIA — Automated Source Curation
 *
 * Validates a candidate source before it is added to any source-list JSON.
 * Runs automated checks with exit code 0 (pass) or 1 (blocked).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/curate-source.ts \
 *     --url "https://philarchive.org/rec/NAGWII" \
 *     --title "What Is It Like to Be a Bat?" \
 *     --author "Thomas Nagel" \
 *     --year 1974 \
 *     --domain philosophy_of_mind \
 *     [--source-type paper] [--wave 1]
 *
 * Checks (in order):
 *   1. URL reachability (HEAD request, 12s timeout)
 *   2. PDF detection — blocked (PDFs not supported in this phase)
 *   3. Duplicate detection — URL match or >85% title similarity vs. existing source lists
 *   4. Token size estimate — warn >100k, block >200k
 *   5. Metadata completeness — title, author, domain required
 *   6. Low-quality source blocklist — rejects Wikipedia, Britannica, Reddit, Quora
 *
 * On pass: prints a ready-to-paste JSON source entry.
 * On block: prints all blocking issues and exits 1.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DOMAIN_VALUES } from '../src/lib/server/prompts/domainZod.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const URL_CHECK_TIMEOUT_MS = 12_000;
const TOKEN_WARN_THRESHOLD = 100_000;
const TOKEN_BLOCK_THRESHOLD = 200_000;
const TITLE_SIMILARITY_THRESHOLD = 0.85;
const DATA_DIR = './data';

const LOW_QUALITY_DOMAINS = [
	'wikipedia.org',
	'britannica.com',
	'reddit.com',
	'quora.com',
	'medium.com',
	'substack.com'
];

const VALID_DOMAIN_SET = new Set<string>(DOMAIN_VALUES);

const VALID_SOURCE_TYPES = ['book', 'paper', 'sep_entry', 'iep_entry', 'article', 'institutional'];

// ─── Types ──────────────────────────────────────────────────────────────────

interface CurationResult {
	url: string;
	title: string;
	blockers: string[];
	warnings: string[];
	estimatedTokens?: number;
	sourceEntry?: SourceEntry;
}

interface SourceEntry {
	id: number;
	title: string;
	author: string[];
	year: number | null;
	url: string;
	source_type: string;
	priority: string;
	subdomain: string;
	wave: number;
	domain: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).length * 1.3);
}

/**
 * Simple bigram-based title similarity (0–1 range).
 * Returns 1.0 for identical strings, 0 for no overlap.
 */
function titleSimilarity(a: string, b: string): number {
	const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
	const na = normalize(a);
	const nb = normalize(b);
	if (na === nb) return 1;

	const bigrams = (s: string): Set<string> => {
		const set = new Set<string>();
		const words = s.split(/\s+/);
		for (let i = 0; i < words.length - 1; i++) {
			set.add(`${words[i]} ${words[i + 1]}`);
		}
		if (words.length === 1) set.add(words[0]); // single-word fallback
		return set;
	};

	const ba = bigrams(na);
	const bb = bigrams(nb);
	let overlap = 0;
	for (const bg of ba) {
		if (bb.has(bg)) overlap++;
	}
	return (2 * overlap) / (ba.size + bb.size);
}

/**
 * Load all source entries from every source-list-*.json in data/.
 */
function loadAllSources(): SourceEntry[] {
	const sources: SourceEntry[] = [];
	if (!fs.existsSync(DATA_DIR)) return sources;

	const files = fs.readdirSync(DATA_DIR).filter(
		(f) => f.startsWith('source-list') && f.endsWith('.json')
	);

	for (const file of files) {
		try {
			const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
			const entries = JSON.parse(raw) as SourceEntry[];
			sources.push(...entries);
		} catch {
			// skip malformed files
		}
	}
	return sources;
}

/**
 * Compute the next available id from all existing source lists.
 */
function nextSourceId(existing: SourceEntry[]): number {
	if (existing.length === 0) return 1;
	return Math.max(...existing.map((s) => s.id)) + 1;
}

async function checkUrl(
	url: string
): Promise<{ reachable: boolean; contentType: string; isPdf: boolean; error?: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: 'HEAD',
			signal: controller.signal,
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOPHIA-Curate/1.0)' }
		});
		clearTimeout(timer);
		const contentType = response.headers.get('content-type') || '';
		const isPdf = contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf');
		return {
			reachable: response.ok,
			contentType,
			isPdf,
			error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`
		};
	} catch (error) {
		clearTimeout(timer);
		const msg = error instanceof Error ? error.message : String(error);
		return {
			reachable: false,
			contentType: '',
			isPdf: url.toLowerCase().endsWith('.pdf'),
			error: msg.includes('AbortError') || msg.includes('abort') ? 'Timeout (12s)' : msg
		};
	}
}

async function fetchPageText(url: string): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30_000);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOPHIA-Curate/1.0)' }
		});
		clearTimeout(timer);
		if (!response.ok) return null;
		const html = await response.text();
		// Strip HTML tags for token estimate
		return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	} catch {
		clearTimeout(timer);
		return null;
	}
}

// ─── Main curation logic ─────────────────────────────────────────────────────

async function curateSource(opts: {
	url: string;
	title: string;
	authors: string[];
	year: number | null;
	domain: string;
	sourceType: string;
	wave: number;
}): Promise<CurationResult> {
	const blockers: string[] = [];
	const warnings: string[] = [];

	// ── Check 1: Metadata completeness ────────────────────────────────────
	if (!opts.title.trim()) blockers.push('Title is required');
	if (opts.authors.length === 0) blockers.push('At least one author is required');
	if (!VALID_DOMAIN_SET.has(opts.domain)) {
		blockers.push(`Invalid domain "${opts.domain}". Valid: ${[...DOMAIN_VALUES].sort().join(', ')}`);
	}
	if (!VALID_SOURCE_TYPES.includes(opts.sourceType)) {
		warnings.push(`Unknown source_type "${opts.sourceType}". Valid: ${VALID_SOURCE_TYPES.join(', ')}`);
	}

	// ── Check 2: Low-quality domain blocklist ─────────────────────────────
	let urlHostname = '';
	try {
		urlHostname = new URL(opts.url).hostname.replace(/^www\./, '');
	} catch {
		blockers.push(`Invalid URL: ${opts.url}`);
	}
	const blockedHost = LOW_QUALITY_DOMAINS.find((d) => urlHostname.includes(d));
	if (blockedHost) {
		blockers.push(`Low-quality source domain: ${blockedHost} — use primary or authoritative source`);
	}

	// ── Check 3: URL reachability + PDF detection ─────────────────────────
	let estimatedTokens: number | undefined;
	if (!blockers.some((b) => b.startsWith('Invalid URL'))) {
		console.log(`  Checking URL...`);
		const { reachable, isPdf, error } = await checkUrl(opts.url);

		if (isPdf) {
			blockers.push('PDF detected — PDFs are not supported in this phase. Use an HTML URL instead.');
		} else if (!reachable) {
			blockers.push(`URL unreachable: ${error ?? 'unknown error'}`);
		} else {
			// ── Check 4: Token size estimate ──────────────────────────────
			console.log(`  Fetching page for token estimate...`);
			const text = await fetchPageText(opts.url);
			if (text) {
				estimatedTokens = estimateTokens(text);
				if (estimatedTokens > TOKEN_BLOCK_THRESHOLD) {
					blockers.push(
						`Estimated token count (${Math.round(estimatedTokens / 1000)}k) exceeds block threshold (${Math.round(TOKEN_BLOCK_THRESHOLD / 1000)}k). Split or find a shorter URL.`
					);
				} else if (estimatedTokens > TOKEN_WARN_THRESHOLD) {
					warnings.push(
						`Large source (~${Math.round(estimatedTokens / 1000)}k tokens) — extraction will be slow but permitted.`
					);
				}
			} else {
				warnings.push('Could not fetch page text for token estimate — proceeding without size check.');
			}
		}
	}

	// ── Check 5: Duplicate detection ──────────────────────────────────────
	const existingSources = loadAllSources();
	const urlDuplicate = existingSources.find((s) => s.url === opts.url);
	if (urlDuplicate) {
		blockers.push(`URL already exists in source list: [${urlDuplicate.id}] ${urlDuplicate.title}`);
	}
	const titleDuplicates = existingSources.filter((s) => {
		const sim = titleSimilarity(s.title, opts.title);
		return sim >= TITLE_SIMILARITY_THRESHOLD && s.url !== opts.url;
	});
	if (titleDuplicates.length > 0) {
		const matches = titleDuplicates.map((s) => `[${s.id}] "${s.title}"`).join(', ');
		blockers.push(`Title is too similar to existing source(s): ${matches}`);
	}

	// ── Build source entry if no blockers ─────────────────────────────────
	let sourceEntry: SourceEntry | undefined;
	if (blockers.length === 0) {
		sourceEntry = {
			id: nextSourceId(existingSources),
			title: opts.title,
			author: opts.authors,
			year: opts.year,
			url: opts.url,
			source_type: opts.sourceType,
			priority: 'high',
			subdomain: opts.domain,
			wave: opts.wave,
			domain: opts.domain
		};
	}

	return { url: opts.url, title: opts.title, blockers, warnings, estimatedTokens, sourceEntry };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);

	const getArg = (flag: string): string | null => {
		const idx = args.indexOf(flag);
		return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
	};

	const url = getArg('--url');
	const title = getArg('--title');
	const authorRaw = getArg('--author');
	const yearRaw = getArg('--year');
	const domain = getArg('--domain');
	const sourceType = getArg('--source-type') ?? 'paper';
	const waveRaw = getArg('--wave') ?? '1';

	if (!url || !title || !domain) {
		console.error('Usage: npx tsx --env-file=.env scripts/curate-source.ts \\');
		console.error('  --url <url>        Source URL (required)');
		console.error('  --title <title>    Source title (required)');
		console.error('  --author <name>    Author name; repeat for multiple (required)');
		console.error('  --domain <domain>  PhilosophicalDomain (required)');
		console.error('  --year <year>      Publication year (optional)');
		console.error('  --source-type <t>  paper|book|sep_entry|iep_entry|article (default: paper)');
		console.error('  --wave <n>         Wave number (default: 1)');
		process.exit(1);
	}

	// Collect all --author values (args may have multiple)
	const authors: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--author' && i + 1 < args.length) {
			authors.push(args[++i]);
		}
	}
	if (authorRaw && authors.length === 0) authors.push(authorRaw);

	const year = yearRaw ? parseInt(yearRaw, 10) : null;
	const wave = parseInt(waveRaw, 10);

	console.log('');
	console.log('╔══════════════════════════════════════════════════════════════╗');
	console.log('║           SOPHIA — SOURCE CURATION CHECK                    ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log('');
	console.log(`  Title:   ${title}`);
	console.log(`  Author:  ${authors.join(', ') || '(none)'}`);
	console.log(`  Year:    ${year ?? 'unknown'}`);
	console.log(`  Domain:  ${domain}`);
	console.log(`  URL:     ${url}`);
	console.log('');

	const result = await curateSource({ url, title, authors, year, domain, sourceType, wave });

	if (result.warnings.length > 0) {
		console.log('⚠  WARNINGS:');
		for (const w of result.warnings) console.log(`   • ${w}`);
		console.log('');
	}

	if (result.blockers.length > 0) {
		console.log('✗  BLOCKED — source cannot be added:');
		for (const b of result.blockers) console.log(`   ✗ ${b}`);
		console.log('');
		process.exit(1);
	}

	if (result.estimatedTokens !== undefined) {
		console.log(`  Estimated tokens: ~${Math.round(result.estimatedTokens / 1000)}k`);
	}

	console.log('');
	console.log('✓  SOURCE PASSED — add this entry to your source-list JSON:');
	console.log('');
	console.log(JSON.stringify(result.sourceEntry, null, 2));
	console.log('');
	process.exit(0);
}

main().catch((err) => {
	console.error('[FATAL]', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
