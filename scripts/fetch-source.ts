import * as fs from 'fs';
import * as path from 'path';
import { parse as parseHTML } from 'node-html-parser';
import {
	buildSourceUrlFetchCandidates,
	canonicalizeAndHashSourceUrl,
	tryParseIngestSourceUrl
} from '../src/lib/server/sourceIdentity.js';

/** SEP / IEP pages use legacy markup (often unclosed tags). Without this, `node-html-parser` can drop `#article-content` / `#main-text` and yield empty extracts. */
const HTML_PARSE_OPTS = { parseNoneClosedTags: true as const };

function parseHtmlDocument(html: string) {
	return parseHTML(html, HTML_PARSE_OPTS);
}

const VALID_SOURCE_TYPES = ['sep_entry', 'iep_entry', 'book', 'paper', 'institutional'];
const DATA_SOURCES_DIR = './data/sources';

function isProbablyHtml(payload: string): boolean {
	const head = payload.slice(0, 2000).toLowerCase();
	return head.includes('<html') || head.includes('<body') || head.includes('<!doctype') || head.includes('<pre');
}

function tryExtractProjectGutenbergId(url: URL): string | null {
	const host = url.hostname.toLowerCase();
	if (host !== 'www.gutenberg.org' && host !== 'gutenberg.org') return null;

	const p = url.pathname;
	// /ebooks/2680
	const ebooks = p.match(/\/ebooks\/(\d+)(?:\/|$)/i);
	if (ebooks?.[1]) return ebooks[1];
	// /files/5682/5682-h/5682-h.htm or /files/2680/2680-0.txt
	const files = p.match(/\/files\/(\d+)(?:\/|$)/i);
	if (files?.[1]) return files[1];
	// /cache/epub/2680/pg2680.txt
	const epub = p.match(/\/cache\/epub\/(\d+)(?:\/|$)/i);
	if (epub?.[1]) return epub[1];

	return null;
}

function projectGutenbergPlainTextUrl(id: string): string {
	const n = id.trim();
	return `https://www.gutenberg.org/cache/epub/${encodeURIComponent(n)}/pg${encodeURIComponent(n)}.txt`;
}

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripGutenbergBoilerplate(raw: string): string {
	const text = normalizeNewlines(raw);

	// Prefer strong START/END markers.
	const startMarkers: RegExp[] = [
		/\*\*\*\s*start of (?:this|the) project gutenberg ebook[\s\S]*?\*\*\*/i,
		/\*\*\*\s*start of (?:this|the) project gutenberg e(?:book|text)[\s\S]*?\*\*\*/i,
		/\*\*\*\s*start[\s\S]*?project gutenberg[\s\S]*?\*\*\*/i
	];
	const endMarkers: RegExp[] = [
		/\*\*\*\s*end of (?:this|the) project gutenberg ebook[\s\S]*?\*\*\*/i,
		/\*\*\*\s*end of (?:this|the) project gutenberg e(?:book|text)[\s\S]*?\*\*\*/i,
		/\*\*\*\s*end[\s\S]*?project gutenberg[\s\S]*?\*\*\*/i
	];

	let startIdx = -1;
	let startLen = 0;
	for (const re of startMarkers) {
		const m = text.match(re);
		if (m?.index != null) {
			startIdx = m.index;
			startLen = m[0].length;
			break;
		}
	}

	let endIdx = -1;
	for (const re of endMarkers) {
		const m = text.match(re);
		if (m?.index != null) {
			endIdx = m.index;
			break;
		}
	}

	let body = text;
	if (startIdx >= 0 && endIdx > startIdx) {
		body = text.slice(startIdx + startLen, endIdx);
	}

	// Secondary license footer patterns (when END marker missing).
	const licenseCut = body.search(/\n\s*(?:end of project gutenberg|start:\s*full license|full project gutenberg license)\b/i);
	if (licenseCut > 0) body = body.slice(0, licenseCut);

	// Common top boilerplate lines.
	body = body
		.replace(/^\s*the project gutenberg e(?:book|text) of[^\n]*\n+/i, '')
		.replace(/^\s*produced by[^\n]*\n+/gim, '')
		.replace(/^\s*\[.*?ebook\s+#?\d+.*?\]\s*\n+/gim, '');

	return body.trim();
}

/** Raw HTML cache: keyed by canonical URL hash; default off (set FETCH_SOURCE_CACHE=1). Respects TTL; reuse reduces flaky HTTP on retry/re-ingest. */
const FETCH_SOURCE_CACHE_ENABLED =
	(process.env.FETCH_SOURCE_CACHE ?? '').trim() === '1' ||
	(process.env.FETCH_SOURCE_CACHE ?? '').toLowerCase() === 'true';
const FETCH_SOURCE_CACHE_TTL_MS = Math.max(
	0,
	Number(process.env.FETCH_SOURCE_CACHE_TTL_HOURS || '24') * 3600 * 1000
);
const FETCH_SOURCE_CACHE_DIR = path.join(process.cwd(), 'data', 'cache', 'fetch-source');

function readFetchCacheIfFresh(cachePath: string): string | null {
	try {
		if (!fs.existsSync(cachePath)) return null;
		const st = fs.statSync(cachePath);
		if (FETCH_SOURCE_CACHE_TTL_MS > 0 && Date.now() - st.mtimeMs > FETCH_SOURCE_CACHE_TTL_MS) {
			return null;
		}
		return fs.readFileSync(cachePath, 'utf-8');
	} catch {
		return null;
	}
}

function writeFetchCache(cachePath: string, html: string): void {
	try {
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(cachePath, html, 'utf-8');
	} catch (error) {
		console.warn(
			`[FETCH CACHE] Could not write ${cachePath}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Create a URL-safe slug from text
 */
function createSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.substring(0, 50);
}

function upgradePlatoToHttps(fetchUrl: string): string {
	try {
		const u = new URL(fetchUrl);
		if (u.protocol === 'http:' && u.hostname.toLowerCase() === 'plato.stanford.edu') {
			u.protocol = 'https:';
			return u.toString();
		}
	} catch {
		// ignore
	}
	return fetchUrl;
}

/**
 * Fetch URL content (follow redirects; retry plato.stanford.edu on http→https if needed).
 */
function isHttpPlatoUrl(rawUrl: string): boolean {
	try {
		const parsed = new URL(rawUrl);
		return parsed.protocol === 'http:' && parsed.hostname === 'plato.stanford.edu';
	} catch {
		return false;
	}
}

async function fetchUrl(url: string, options?: { cacheKey?: string }): Promise<string> {
	const cacheKey = options?.cacheKey;
	const cachePath =
		cacheKey && FETCH_SOURCE_CACHE_ENABLED
			? path.join(FETCH_SOURCE_CACHE_DIR, `${cacheKey}.html`)
			: null;

	if (cachePath) {
		const cached = readFetchCacheIfFresh(cachePath);
		if (cached != null) {
			console.log(`[FETCH] Using cached HTML (${cached.length.toLocaleString()} bytes) for ${url}`);
			return cached;
		}
	}

	const baseCandidates = buildSourceUrlFetchCandidates(url);
	const candidates: string[] = [];
	const seen = new Set<string>();
	for (const c of baseCandidates) {
		for (const v of [upgradePlatoToHttps(c), c]) {
			if (!seen.has(v)) {
				seen.add(v);
				candidates.push(v);
			}
		}
	}

	const headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
		Accept: 'text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9'
	};

	let lastErr = 'no attempts';
	for (let i = 0; i < candidates.length; i++) {
		let current = candidates[i]!;
		console.log(`[FETCH] Downloading (${i + 1}/${candidates.length}) ${current}...`);
		try {
			let response = await fetch(current, { redirect: 'follow', headers });
			if (!response.ok && isHttpPlatoUrl(current)) {
				const httpsUrl = upgradePlatoToHttps(current);
				if (httpsUrl !== current) {
					console.log(`[FETCH] Retrying over HTTPS: ${httpsUrl}`);
					response = await fetch(httpsUrl, { redirect: 'follow', headers });
					current = httpsUrl;
				}
			}
			if (!response.ok) {
				lastErr = `HTTP ${response.status}: ${response.statusText}`;
				continue;
			}
			const effectiveUrl = response.url || current;
			const contentType = response.headers.get('content-type') || '';
			if (contentType.includes('application/pdf') || effectiveUrl.toLowerCase().endsWith('.pdf')) {
				lastErr = 'Response is PDF, not HTML';
				continue;
			}
			const html = await response.text();
			if (html.startsWith('%PDF')) {
				lastErr = 'Body looks like PDF';
				continue;
			}
			if (html.length < 500) {
				lastErr = `Body too short (${html.length} bytes) — likely block or empty page`;
				continue;
			}
			console.log(`[FETCH] Downloaded ${html.length.toLocaleString()} bytes`);
			if (cachePath) {
				writeFetchCache(cachePath, html);
			}
			return html;
		} catch (error) {
			lastErr = error instanceof Error ? error.message : String(error);
		}
	}

	throw new Error(`Failed to fetch URL after ${candidates.length} attempt(s): ${lastErr}`);
}

/**
 * Extract Stanford Encyclopedia of Philosophy entry
 */
function extractSepEntry(html: string): { text: string; title: string; author: string[] } {
	const root = parseHtmlDocument(html);

	// Find main article content (SEP has used #main-text, #article-content, .entry-content, etc.)
	const mainSelectors = [
		'#main-text',
		'#article-content',
		'.entry-content',
		'article#article',
		'#article',
		'main',
		'[role="main"]',
		'article'
	];
	let mainContent: ReturnType<typeof root.querySelector> = null;
	for (const sel of mainSelectors) {
		mainContent = root.querySelector(sel);
		if (mainContent) break;
	}

	if (!mainContent) {
		throw new Error(
			'Could not find main article content (expected #main-text, #article-content, .entry-content, or article/main)'
		);
	}

	// Extract title - try multiple selectors
	let title = 'Unknown Title';
	const titleSelectors = [
		'h1.title',
		'h1#aueditable',
		'h1[property="name"]',
		'h1',
		'.entry-title',
		'title'
	];
	
	for (const selector of titleSelectors) {
		const titleNode = root.querySelector(selector);
		if (titleNode?.text && titleNode.text.trim() !== '') {
			title = titleNode.text.trim();
			// Clean up title if it came from <title> tag
			if (selector === 'title') {
				// Remove common suffixes like " (Stanford Encyclopedia of Philosophy)"
				title = title.replace(/\s*\(Stanford Encyclopedia of Philosophy\)\s*$/i, '');
				title = title.replace(/\s*\|.*$/i, ''); // Remove anything after pipe
			}
			break;
		}
	}

	// Extract author from meta or page - try multiple approaches
	let author: string[] = [];
	
	// Try meta author tags first (SEP uses property="citation_author")
	let metaAuthor = root.querySelector('meta[property="citation_author"]');
	if (!metaAuthor) {
		metaAuthor = root.querySelector('meta[name="citation_author"]');
	}
	if (metaAuthor) {
		const content = metaAuthor.getAttribute('content');
		if (content) {
			author = [content.trim()];
		}
	}
	
	// Try DC.Creator meta tag
	if (author.length === 0) {
		const dcCreator = root.querySelector('meta[name="DC.creator"]') || root.querySelector('meta[name="DC.Creator"]');
		if (dcCreator) {
			const content = dcCreator.getAttribute('content');
			if (content) {
				author = [content.trim()];
			}
		}
	}
	
	// Try visible author elements
	if (author.length === 0) {
		const authorSelectors = ['.author', '#article-author', '.entry-author', '[rel="author"]'];
		for (const selector of authorSelectors) {
			const authorNode = root.querySelector(selector);
			if (authorNode?.text && authorNode.text.trim() !== '') {
				author = [authorNode.text.trim()];
				break;
			}
		}
	}

	// Remove nav elements, bibliography, footnotes
	const nodesToRemove = [
		'nav',
		'.navigation',
		'.toc',
		'.table-of-contents',
		'.bibliography',
		'#references',
		'.footnotes',
		'.endnotes',
		'.see-also'
	];

	for (const selector of nodesToRemove) {
		mainContent.querySelectorAll(selector).forEach((node) => {
			node.remove();
		});
	}

	const text = mainContent.text.trim();
	if (text.length < 400) {
		throw new Error(
			`SEP entry body is too short (${text.length} chars) after extraction — page layout may have changed or HTML failed to parse.`
		);
	}
	return { text, title, author };
}

/**
 * Extract Internet Encyclopedia of Philosophy entry
 */
function extractIepEntry(html: string): { text: string; title: string; author: string[] } {
	const root = parseHtmlDocument(html);

	// Find main article
	let mainContent = root.querySelector('.article-content');
	if (!mainContent) {
		mainContent = root.querySelector('article');
	}
	if (!mainContent) {
		mainContent = root.querySelector('.content');
	}

	if (!mainContent) {
		throw new Error('Could not find main article content');
	}

	// Extract title
	let titleNode = root.querySelector('h1');
	let title = titleNode?.text || 'Unknown Title';

	// Extract author
	let author: string[] = [];
	const authorNode = root.querySelector('.author, .by-author');
	if (authorNode) {
		const authorText = authorNode.text.replace(/^(by|author:|)\s*/i, '').trim();
		author = [authorText];
	}

	// Remove sidebar, nav, footnotes
	mainContent.querySelectorAll('nav, .sidebar, .navigation, .footnotes, .references').forEach((n) => {
		n.remove();
	});

	const text = mainContent.text.trim();
	return { text, title, author };
}

/**
 * Extract Project Gutenberg text
 */
function extractGutenbergText(payload: string): { text: string; title: string; author: string[] } {
	let raw = payload;

	// Some Gutenberg URLs are HTML pages; try to extract text from <pre> first, otherwise fall back to DOM text.
	if (isProbablyHtml(raw)) {
		const root = parseHtmlDocument(raw);
		const pre = root.querySelector('pre');
		if (pre?.text?.trim()) {
			raw = pre.text;
		} else {
			const body = root.querySelector('body') ?? root;
			raw = body.text;
		}
	}

	const normalized = normalizeNewlines(raw);

	// Title/author best-effort: plain-text header lines or the common “eBook of …, by …” preamble.
	const titleMatch = normalized.match(/^Title:\s*(.+?)$/m);
	const authorMatch = normalized.match(/^Author:\s*(.+?)$/m);

	let title = titleMatch ? titleMatch[1].trim() : '';
	let author: string[] = authorMatch ? [authorMatch[1].trim()] : [];
	if (!title) {
		const m = normalized.match(/\bProject Gutenberg e(?:Book|text)\s+of\s+(.+?)(?:,?\s+by\s+(.+?))?\s*(?:\r?\n|$)/i);
		if (m?.[1]) title = m[1].trim();
		if (author.length === 0 && m?.[2]) author = [m[2].trim()];
	}

	const text = stripGutenbergBoilerplate(normalized);

	return { text, title: title || 'Unknown Title', author };
}

/**
 * Extract generic HTML content
 */
function extractGenericContent(
	html: string,
	sourceType: string
): { text: string; title: string; author: string[] } {
	const root = parseHtmlDocument(html);

	// Try common content selectors
	let mainContent =
		root.querySelector('article') ||
		root.querySelector('.content') ||
		root.querySelector('main') ||
		root.querySelector('.article');

	if (!mainContent) {
		// Fallback: use body for old-style HTML documents (e.g. HTML 3.2)
		mainContent = root.querySelector('body');
	}

	if (!mainContent) {
		throw new Error('Could not find main content in page');
	}

	// Title/author before stripping nodes — WordPress often wraps the post title in <header>,
	// and removing header first would delete <h1> and break title detection.
	let title = 'Unknown Title';
	const titleTag = root.querySelector('title');
	const h1 = root.querySelector('h1, .title');
	const h2 = root.querySelector('h2');
	if (h1?.text?.trim()) {
		title = h1.text.trim();
	} else if (h2?.text?.trim()) {
		title = h2.text.trim();
	} else if (titleTag?.text?.trim()) {
		title = titleTag.text.trim().replace(/\s*\|.*$/, '').trim();
	}

	const authorNode = root.querySelector('.author, [rel="author"]');
	const author = authorNode ? [authorNode.text] : [];

	// Remove navigation and boilerplate
	mainContent.querySelectorAll('nav, header, footer, .nav, .sidebar').forEach((n) => {
		n.remove();
	});

	return { text: mainContent.text.trim(), title, author };
}

/**
 * Clean and extract text based on source type
 */
function cleanSourceText(
	html: string,
	sourceType: string
): { text: string; title: string; author: string[] } {
	console.log(`[CLEAN] Extracting content for source type: ${sourceType}`);

	try {
		switch (sourceType) {
			case 'sep_entry':
				return extractSepEntry(html);
			case 'iep_entry':
				return extractIepEntry(html);
			case 'book':
				return extractGutenbergText(html);
			case 'paper':
			case 'institutional':
				return extractGenericContent(html, sourceType);
			default:
				throw new Error(`Unknown source type: ${sourceType}`);
		}
	} catch (error) {
		console.error(`[CLEAN] Extraction error:`, error);
		throw error;
	}
}

/**
 * Estimate tokens from word count (crude estimate: ~1.3 words per token for English)
 */
function estimateTokens(text: string): number {
	const words = text.trim().split(/\s+/).length;
	return Math.ceil(words * 1.3);
}

/**
 * Main script
 */
async function main() {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.error('Usage: npx tsx --env-file=.env scripts/fetch-source.ts <url> <source-type>');
		console.error(`Source types: ${VALID_SOURCE_TYPES.join(', ')}`);
		process.exit(1);
	}

	const [url, sourceType] = args;

	// Validate source type
	if (!VALID_SOURCE_TYPES.includes(sourceType)) {
		console.error(`Invalid source type: ${sourceType}`);
		console.error(`Valid types: ${VALID_SOURCE_TYPES.join(', ')}`);
		process.exit(1);
	}

	// Create data directory if needed
	if (!fs.existsSync(DATA_SOURCES_DIR)) {
		fs.mkdirSync(DATA_SOURCES_DIR, { recursive: true });
		console.log(`[SETUP] Created directory: ${DATA_SOURCES_DIR}`);
	}

	try {
		const parsed = tryParseIngestSourceUrl(url);
		if (!parsed) {
			throw new Error(`Unsupported or invalid source URL: ${url}`);
		}
		const sourceIdentity = canonicalizeAndHashSourceUrl(parsed.toString());
		if (!sourceIdentity) {
			throw new Error(`Unsupported or invalid source URL: ${url}`);
		}

		// Fetch the URL (optional disk cache by canonical hash — polite reuse on retry/re-ingest)
		let fetched = '';
		if (sourceType === 'book') {
			const parsedUrl = new URL(sourceIdentity.canonicalUrl);
			const pgId = tryExtractProjectGutenbergId(parsedUrl);
			if (pgId) {
				const plain = projectGutenbergPlainTextUrl(pgId);
				try {
					console.log(`[FETCH] Gutenberg: preferring plain text ${plain}`);
					fetched = await fetchUrl(plain, { cacheKey: `${sourceIdentity.canonicalUrlHash}-pg${pgId}` });
				} catch (e) {
					console.warn(
						`[FETCH] Gutenberg plain-text fetch failed; falling back to canonical URL. Reason: ${
							e instanceof Error ? e.message : String(e)
						}`
					);
				}
			}
		}
		if (!fetched) {
			fetched = await fetchUrl(sourceIdentity.canonicalUrl, {
				cacheKey: sourceIdentity.canonicalUrlHash
			});
		}

		// Clean and extract
		const { text, title, author } = cleanSourceText(fetched, sourceType);

		// Calculate metrics
		const wordCount = text.trim().split(/\s+/).length;
		const charCount = text.length;
		const estimatedTokens = estimateTokens(text);

		// Create slug
		const slug = createSlug(title);

		// Save cleaned text
		const textPath = path.join(DATA_SOURCES_DIR, `${slug}.txt`);
		fs.writeFileSync(textPath, text, 'utf-8');
		console.log(`[SAVE] Cleaned text: ${textPath}`);

		// Save metadata
		const metadata = {
			title,
			author,
			source_type: sourceType,
			url: sourceIdentity.canonicalUrl,
			canonical_url: sourceIdentity.canonicalUrl,
			canonical_url_hash: sourceIdentity.canonicalUrlHash,
			visibility_scope: 'public_shared',
			deletion_state: 'active',
			fetched_at: new Date().toISOString(),
			word_count: wordCount,
			char_count: charCount,
			estimated_tokens: estimatedTokens,
			local_slug: slug
		};

		const metaPath = path.join(DATA_SOURCES_DIR, `${slug}.meta.json`);
		fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
		console.log(`[SAVE] Metadata: ${metaPath}`);

		// Print summary
		console.log('\n[SUMMARY] SOURCE FETCHED SUCCESSFULLY');
		console.log(`Title: ${title}`);
		if (author.length > 0) {
			console.log(`Author(s): ${author.join(', ')}`);
		}
		console.log(`Source Type: ${sourceType}`);
		console.log(`URL: ${sourceIdentity.canonicalUrl}`);
		console.log(`Word Count: ${wordCount.toLocaleString()}`);
		console.log(`Character Count: ${charCount.toLocaleString()}`);
		console.log(`Estimated Tokens: ${estimatedTokens.toLocaleString()}`);
		console.log(`Files saved to: data/sources/${slug}.*`);

		// Warning for very large sources
		if (estimatedTokens > 100_000) {
			console.warn(
				'\n⚠️  WARNING: This source (~' +
					estimatedTokens.toLocaleString() +
					' tokens) exceeds Claude\'s typical context window.'
			);
			console.warn('Consider breaking it into sections for ingestion.');
		}

		console.log('');
		process.exit(0);
	} catch (error) {
		console.error('\n[ERROR]', error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

main();
