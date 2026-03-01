/**
 * SOPHIA — Pre-scan Script
 *
 * Scans all ingestion targets for potential issues BEFORE running the full pipeline.
 * Checks: URL reachability, PDF detection, token size, section split estimates.
 * No expensive API calls (Claude / Voyage / Gemini) are made.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/pre-scan.ts [--wave 1|2|3] [--json]
 *
 * Exit codes:
 *   0 — All clear (no blockers found)
 *   1 — Blockers found (unreachable URLs, PDFs, or other hard errors)
 *
 * Can also be imported by ingest-batch.ts via runPreScan().
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Configuration ──────────────────────────────────────────────────────────
export const SOURCE_LIST_PATH = './data/source-list-3a.json';
const SOURCES_DIR = './data/sources';

// Must stay in sync with ingest.ts
const MAX_TOKENS_PER_SECTION = 10_000;
// Warn if a section's estimated token count exceeds this factor × threshold
const WARN_FACTOR = 1.5;
// Warn if total source tokens exceed this value
const LARGE_SOURCE_THRESHOLD = 100_000;
// Warn if section count exceeds this value
const MANY_SECTIONS_THRESHOLD = 20;
// HTTP HEAD request timeout in ms
const URL_CHECK_TIMEOUT_MS = 12_000;

// ─── Types ──────────────────────────────────────────────────────────────────
export interface SourceEntry {
	id: number;
	title: string;
	author: string[];
	year: number | null;
	url: string;
	source_type: string;
	priority: string;
	subdomain: string;
	wave: number;
}

export interface ScanResult {
	id: number;
	title: string;
	wave: number;
	priority: string;
	url: string;
	/** Text file already downloaded locally */
	cached: boolean;
	/** Slug used for the local .txt file (if cached) */
	slug?: string;
	/** Only set when NOT cached — result of URL HEAD check */
	reachable?: boolean;
	contentType?: string;
	isPdf?: boolean;
	/** Total token estimate for the full source text */
	totalTokens?: number;
	/** Number of sections after applying splitIntoSections logic */
	sectionCount?: number;
	/** Token count of the largest section */
	maxSectionTokens?: number;
	/** Non-fatal issues */
	warnings: string[];
	/** Hard error / blocker reason */
	error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.substring(0, 50);
}

function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).length * 1.3);
}

function findFetchedSlug(url: string): string | null {
	try {
		const files = fs.readdirSync(SOURCES_DIR);
		for (const file of files) {
			if (!file.endsWith('.meta.json')) continue;
			const metaPath = path.join(SOURCES_DIR, file);
			try {
				const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { url?: string };
				if (meta.url === url) return file.replace('.meta.json', '');
			} catch {
				// skip unreadable meta files
			}
		}
	} catch {
		// SOURCES_DIR doesn't exist yet
	}
	return null;
}

/**
 * Estimate section split — mirrors splitIntoSections() in ingest.ts exactly.
 * Returns the number of sections and the max token count per section.
 */
function estimateSections(text: string): {
	count: number;
	maxTokens: number;
	tokenCounts: number[];
} {
	// ── Step 1: heading-based split ─────────────────────────────────────────
	const lines = text.split('\n');
	const rawSections: string[] = [];
	let current: string[] = [];

	for (const line of lines) {
		const isHeading =
			/^\d+\.\s+[A-Z]/.test(line) ||
			/^#{1,3}\s/.test(line) ||
			/^[A-Z][A-Z\s]{10,}$/.test(line.trim()) ||
			/^(?:Chapter|Section|Part)\s+\d/i.test(line);

		if (isHeading && current.length > 0) {
			const t = current.join('\n').trim();
			if (t.length > 100) rawSections.push(t);
			current = [line];
		} else {
			current.push(line);
		}
	}
	if (current.length > 0) {
		const t = current.join('\n').trim();
		if (t.length > 100) rawSections.push(t);
	}

	// ── Step 2: fallback to character chunks if no headings found ───────────
	let sections: string[];
	if (rawSections.length <= 1) {
		const chunkSize = 40_000;
		sections = [];
		for (let i = 0; i < text.length; i += chunkSize) {
			sections.push(text.substring(i, i + chunkSize));
		}
	} else {
		// ── Step 3: merge small sections ──────────────────────────────────
		const merged: string[] = [];
		let buffer = '';
		for (const section of rawSections) {
			if (
				estimateTokens(buffer + '\n\n' + section) > MAX_TOKENS_PER_SECTION &&
				buffer.length > 0
			) {
				merged.push(buffer.trim());
				buffer = section;
			} else {
				buffer = buffer ? buffer + '\n\n' + section : section;
			}
		}
		if (buffer.length > 0) merged.push(buffer.trim());

		// ── Step 4: sub-split oversized chunks ────────────────────────────
		sections = [];
		const charChunkSize = MAX_TOKENS_PER_SECTION * 4;
		for (const chunk of merged) {
			if (estimateTokens(chunk) > MAX_TOKENS_PER_SECTION) {
				for (let i = 0; i < chunk.length; i += charChunkSize) {
					const sub = chunk.substring(i, i + charChunkSize).trim();
					if (sub.length > 100) sections.push(sub);
				}
			} else {
				sections.push(chunk);
			}
		}
	}

	const tokenCounts = sections.map(estimateTokens);
	return {
		count: sections.length,
		maxTokens: tokenCounts.length > 0 ? Math.max(...tokenCounts) : 0,
		tokenCounts
	};
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
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOPHIA-PreScan/1.0)' }
		});
		clearTimeout(timer);
		const contentType = response.headers.get('content-type') || '';
		const isPdf =
			contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf');
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
			error: msg.includes('AbortError') || msg.includes('abort') ? 'Timeout' : msg
		};
	}
}

// ─── Core scan logic ────────────────────────────────────────────────────────

async function scanSource(source: SourceEntry): Promise<ScanResult> {
	const warnings: string[] = [];
	const slug = createSlug(source.title);

	// Check if already fetched locally (by URL match in meta.json, or by slug)
	let fetchedSlug = findFetchedSlug(source.url);
	if (!fetchedSlug && fs.existsSync(path.join(SOURCES_DIR, `${slug}.txt`))) {
		fetchedSlug = slug;
	}

	if (fetchedSlug) {
		// ── Source is cached locally — analyse the text ──────────────────
		const txtPath = path.join(SOURCES_DIR, `${fetchedSlug}.txt`);
		let text: string;
		try {
			text = fs.readFileSync(txtPath, 'utf-8');
		} catch (err) {
			return {
				id: source.id,
				title: source.title,
				wave: source.wave,
				priority: source.priority,
				url: source.url,
				cached: true,
				slug: fetchedSlug,
				warnings: [],
				error: `Cannot read cached file: ${err instanceof Error ? err.message : err}`
			};
		}

		const totalTokens = estimateTokens(text);
		const { count, maxTokens, tokenCounts } = estimateSections(text);

		// Check for sections that are still larger than threshold (auto-split will handle them,
		// but it's useful to know in advance)
		const oversizedSections = tokenCounts.filter((t) => t > MAX_TOKENS_PER_SECTION * WARN_FACTOR);
		if (oversizedSections.length > 0) {
			warnings.push(
				`${oversizedSections.length} section(s) exceed ${MAX_TOKENS_PER_SECTION * WARN_FACTOR} tokens ` +
					`(max: ${maxTokens.toLocaleString()}) — auto-split will activate`
			);
		}
		if (totalTokens > LARGE_SOURCE_THRESHOLD) {
			warnings.push(
				`Very large source (~${Math.round(totalTokens / 1000)}k tokens) — extraction will be slow`
			);
		}
		if (count > MANY_SECTIONS_THRESHOLD) {
			warnings.push(
				`${count} sections → ${count} Claude extraction calls — expect long runtime`
			);
		}

		return {
			id: source.id,
			title: source.title,
			wave: source.wave,
			priority: source.priority,
			url: source.url,
			cached: true,
			slug: fetchedSlug,
			totalTokens,
			sectionCount: count,
			maxSectionTokens: maxTokens,
			warnings
		};
	} else {
		// ── Source not cached — check URL reachability ───────────────────
		const { reachable, contentType, isPdf, error } = await checkUrl(source.url);

		if (isPdf) {
			warnings.push('PDF detected — not directly supported. Use an HTML URL instead.');
		}
		if (!reachable) {
			warnings.push(`URL unreachable: ${error ?? 'unknown error'}`);
		}

		return {
			id: source.id,
			title: source.title,
			wave: source.wave,
			priority: source.priority,
			url: source.url,
			cached: false,
			reachable,
			contentType,
			isPdf,
			warnings,
			error: reachable ? undefined : error
		};
	}
}

// ─── Report formatting ──────────────────────────────────────────────────────

function formatReport(results: ScanResult[], waveFilter: number | null): void {
	const W = 74;
	const hr = '─'.repeat(W);

	console.log('╔' + '═'.repeat(W) + '╗');
	console.log(
		'║' + '           SOPHIA — PRE-SCAN REPORT'.padEnd(W) + '║'
	);
	console.log('╚' + '═'.repeat(W) + '╝');
	if (waveFilter !== null) console.log(`Wave filter: ${waveFilter}`);
	console.log(`Scanned:    ${results.length} sources`);
	console.log(`Threshold:  ${MAX_TOKENS_PER_SECTION.toLocaleString()} tokens/section (MAX_TOKENS_PER_SECTION)`);
	console.log('');

	const blockers = results.filter((r) => r.reachable === false || r.isPdf || r.error);
	const warnings = results.filter(
		(r) => r.warnings.length > 0 && r.reachable !== false && !r.isPdf && !r.error
	);
	const clean = results.filter(
		(r) => r.warnings.length === 0 && r.reachable !== false && !r.isPdf && !r.error
	);

	// ── Blockers ───────────────────────────────────────────────────────────
	if (blockers.length > 0) {
		console.log(`✗  BLOCKERS — fix before ingestion (${blockers.length}):`);
		console.log(hr);
		for (const r of blockers) {
			console.log(`[${r.id}] ${r.title} (wave ${r.wave}, ${r.priority})`);
			console.log(`    URL: ${r.url}`);
			for (const w of r.warnings) console.log(`    ✗  ${w}`);
			if (r.error && !r.warnings.some((w) => w.includes(r.error!)))
				console.log(`    ✗  ${r.error}`);
			console.log('');
		}
	}

	// ── Warnings ───────────────────────────────────────────────────────────
	if (warnings.length > 0) {
		console.log(`⚠  WARNINGS — will ingest but may be slow (${warnings.length}):`);
		console.log(hr);
		for (const r of warnings) {
			const sizeInfo = r.cached
				? `~${Math.round(r.totalTokens! / 1000)}k tokens, ${r.sectionCount} sections`
				: 'not cached';
			console.log(`[${r.id}] ${r.title} (wave ${r.wave}) — ${sizeInfo}`);
			for (const w of r.warnings) console.log(`    ⚠  ${w}`);
			console.log('');
		}
	}

	// ── Clean ──────────────────────────────────────────────────────────────
	if (clean.length > 0) {
		console.log(`✓  READY (${clean.length}):`);
		console.log(hr);
		for (const r of clean) {
			if (r.cached) {
				console.log(
					`  [${r.id}] ${r.title} (wave ${r.wave}) ` +
						`— ~${Math.round(r.totalTokens! / 1000)}k tokens, ${r.sectionCount} section(s)`
				);
			} else {
				console.log(`  [${r.id}] ${r.title} (wave ${r.wave}) — reachable, not yet fetched`);
			}
		}
		console.log('');
	}

	// ── Summary ────────────────────────────────────────────────────────────
	const cached = results.filter((r) => r.cached);
	const totalTokens = cached.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
	const totalSections = cached.reduce((sum, r) => sum + (r.sectionCount ?? 0), 0);
	const uncached = results.filter((r) => !r.cached);

	console.log(hr);
	console.log('SUMMARY:');
	console.log(`  Sources scanned:              ${results.length}`);
	console.log(`  Cached locally:               ${cached.length}`);
	console.log(`  Not yet fetched:              ${uncached.length}`);
	console.log(
		`  Blockers (fix required):      ${blockers.length}` +
			(blockers.length > 0 ? '  ← ACTION REQUIRED' : '')
	);
	console.log(`  Warnings (slow but runnable): ${warnings.length}`);
	console.log(`  Clean:                        ${clean.length}`);
	if (cached.length > 0) {
		console.log(`  Total cached tokens:          ~${Math.round(totalTokens / 1000)}k`);
		console.log(
			`  Total estimated sections:     ${totalSections}  (= Claude extraction API calls)`
		);
	}

	if (blockers.length > 0) {
		console.log('');
		console.log('ACTION REQUIRED — fix these URLs before running ingestion:');
		for (const r of blockers) {
			const reason = r.isPdf ? 'PDF — need HTML URL' : r.error ?? 'unreachable';
			console.log(`  [${r.id}] ${r.title}`);
			console.log(`        Current: ${r.url}`);
			console.log(`        Issue:   ${reason}`);
		}
	}
	console.log('');
}

// ─── Public API (used by ingest-batch.ts) ──────────────────────────────────

export async function runPreScan(
	sources: SourceEntry[],
	waveFilter: number | null,
	options: { quiet?: boolean; jsonOutput?: boolean } = {}
): Promise<{ results: ScanResult[]; hasBlockers: boolean }> {
	const results: ScanResult[] = [];

	for (const source of sources) {
		if (!options.quiet) {
			const label = `[${source.id}] ${source.title.substring(0, 48)}`;
			process.stdout.write(`  Scanning ${label.padEnd(50)}...`);
		}

		const result = await scanSource(source);
		results.push(result);

		if (!options.quiet) {
			let statusStr: string;
			if (result.cached) {
				statusStr = `cached (~${Math.round((result.totalTokens ?? 0) / 1000)}k t, ${result.sectionCount} sec)`;
			} else if (result.reachable === false) {
				statusStr = 'UNREACHABLE';
			} else if (result.isPdf) {
				statusStr = 'PDF (blocked)';
			} else {
				statusStr = 'reachable';
			}
			const warnStr = result.warnings.length > 0 ? ` [${result.warnings.length} warn]` : '';
			console.log(` ${statusStr}${warnStr}`);
		}
	}

	const hasBlockers = results.some(
		(r) => r.reachable === false || r.isPdf === true || Boolean(r.error)
	);

	if (options.jsonOutput) {
		console.log(JSON.stringify(results, null, 2));
	} else if (!options.quiet) {
		console.log('');
		formatReport(results, waveFilter);
	}

	return { results, hasBlockers };
}

// ─── CLI entry point ────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	let waveFilter: number | null = null;
	let jsonOutput = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--wave' && i + 1 < args.length) {
			waveFilter = parseInt(args[i + 1], 10);
			i++;
		} else if (args[i] === '--json') {
			jsonOutput = true;
		}
	}

	if (!fs.existsSync(SOURCE_LIST_PATH)) {
		console.error(`[ERROR] Source list not found: ${SOURCE_LIST_PATH}`);
		process.exit(1);
	}

	let sources: SourceEntry[] = JSON.parse(fs.readFileSync(SOURCE_LIST_PATH, 'utf-8'));
	if (waveFilter !== null) {
		sources = sources.filter((s) => s.wave === waveFilter);
	}

	if (sources.length === 0) {
		console.log('[INFO] No sources to scan');
		process.exit(0);
	}

	if (!jsonOutput) {
		console.log(`Scanning ${sources.length} source(s)${waveFilter !== null ? ` (wave ${waveFilter})` : ''}...\n`);
	}

	const { hasBlockers } = await runPreScan(sources, waveFilter, { jsonOutput });
	process.exit(hasBlockers ? 1 : 0);
}

main();
