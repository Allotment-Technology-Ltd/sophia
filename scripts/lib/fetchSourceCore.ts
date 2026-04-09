/**
 * Shared HTML fetch + clean pipeline for `fetch-source.ts` and `ingest.ts` refetch-on-resume.
 */

import { parse as parseHTML } from 'node-html-parser';
import { canonicalizeAndHashSourceUrl } from '../../src/lib/server/sourceIdentity.js';

export const VALID_INGEST_SOURCE_TYPES = [
	'sep_entry',
	'iep_entry',
	'book',
	'paper',
	'institutional'
] as const;

export type IngestFetchSourceType = (typeof VALID_INGEST_SOURCE_TYPES)[number];

function createSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.substring(0, 50);
}

async function fetchUrl(url: string, quiet: boolean): Promise<string> {
	if (!quiet) console.log(`[FETCH] Downloading from ${url}...`);
	try {
		const response = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOPHIA-Fetch/1.0)' }
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
			throw new Error(
				'PDF files cannot be parsed as HTML. Update the source URL to an HTML version.'
			);
		}
		const html = await response.text();
		if (html.startsWith('%PDF')) {
			throw new Error(
				'Response is a PDF file (detected by content). Update the source URL to an HTML version.'
			);
		}
		if (!quiet) console.log(`[FETCH] Downloaded ${html.length.toLocaleString()} bytes`);
		return html;
	} catch (error) {
		throw new Error(`Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function extractSepEntry(html: string): { text: string; title: string; author: string[] } {
	const root = parseHTML(html);

	let mainContent = root.querySelector('#main-text');
	if (!mainContent) {
		mainContent = root.querySelector('.entry-content');
	}
	if (!mainContent) {
		mainContent = root.querySelector('article');
	}

	if (!mainContent) {
		throw new Error('Could not find main article content (expected #main-text or .entry-content)');
	}

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
			if (selector === 'title') {
				title = title.replace(/\s*\(Stanford Encyclopedia of Philosophy\)\s*$/i, '');
				title = title.replace(/\s*\|.*$/i, '');
			}
			break;
		}
	}

	let author: string[] = [];

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

	if (author.length === 0) {
		const dcCreator =
			root.querySelector('meta[name="DC.creator"]') || root.querySelector('meta[name="DC.Creator"]');
		if (dcCreator) {
			const content = dcCreator.getAttribute('content');
			if (content) {
				author = [content.trim()];
			}
		}
	}

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
	return { text, title, author };
}

function extractIepEntry(html: string): { text: string; title: string; author: string[] } {
	const root = parseHTML(html);

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

	const titleNode = root.querySelector('h1');
	const title = titleNode?.text || 'Unknown Title';

	let author: string[] = [];
	const authorNode = root.querySelector('.author, .by-author');
	if (authorNode) {
		const authorText = authorNode.text.replace(/^(by|author:|)\s*/i, '').trim();
		author = [authorText];
	}

	mainContent.querySelectorAll('nav, .sidebar, .navigation, .footnotes, .references').forEach((n) => {
		n.remove();
	});

	const text = mainContent.text.trim();
	return { text, title, author };
}

function extractGutenbergText(html: string): { text: string; title: string; author: string[] } {
	const startMatch = html.match(/\*\*\*\s*START.+?\*\*\*/s);
	const endMatch = html.match(/\*\*\*\s*END.+?\*\*\*/s);

	let text = html;
	if (startMatch && endMatch) {
		text = html.substring(startMatch.index! + startMatch[0].length, endMatch.index);
	}

	const titleMatch = html.match(/^Title:\s*(.+?)$/m);
	const authorMatch = html.match(/^Author:\s*(.+?)$/m);

	const title = titleMatch ? titleMatch[1].trim() : 'Unknown Title';
	const author = authorMatch ? [authorMatch[1].trim()] : [];

	return { text: text.trim(), title, author };
}

function extractGenericContent(
	html: string,
	sourceType: string
): { text: string; title: string; author: string[] } {
	const root = parseHTML(html);

	let mainContent =
		root.querySelector('article') ||
		root.querySelector('.content') ||
		root.querySelector('main') ||
		root.querySelector('.article');

	if (!mainContent) {
		mainContent = root.querySelector('body');
	}

	if (!mainContent) {
		throw new Error('Could not find main content in page');
	}

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

	mainContent.querySelectorAll('nav, header, footer, .nav, .sidebar').forEach((n) => {
		n.remove();
	});

	return { text: mainContent.text.trim(), title, author };
}

function cleanSourceText(
	html: string,
	sourceType: string,
	quiet: boolean
): { text: string; title: string; author: string[] } {
	if (!quiet) console.log(`[CLEAN] Extracting content for source type: ${sourceType}`);

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

function estimateTokens(text: string): number {
	const words = text.trim().split(/\s+/).length;
	return Math.ceil(words * 1.3);
}

export interface FetchedSourcePayload {
	text: string;
	titleSlug: string;
	meta: {
		title: string;
		author: string[];
		source_type: string;
		url: string;
		canonical_url: string;
		canonical_url_hash: string;
		visibility_scope: string;
		deletion_state: string;
		fetched_at: string;
		word_count: number;
		char_count: number;
		estimated_tokens: number;
		local_slug: string;
	};
	canonicalUrl: string;
	canonicalUrlHash: string;
}

/**
 * Download URL, extract main text, and build the same metadata shape as `fetch-source.ts` writes to .meta.json.
 */
export async function fetchParsedSourceForIngest(
	urlInput: string,
	sourceType: string,
	opts?: { quiet?: boolean }
): Promise<FetchedSourcePayload> {
	const quiet = opts?.quiet === true;
	if (!VALID_INGEST_SOURCE_TYPES.includes(sourceType as IngestFetchSourceType)) {
		throw new Error(`Invalid source type: ${sourceType}`);
	}

	const sourceIdentity = canonicalizeAndHashSourceUrl(urlInput);
	if (!sourceIdentity) {
		throw new Error(`Unsupported or invalid source URL: ${urlInput}`);
	}

	const html = await fetchUrl(sourceIdentity.canonicalUrl, quiet);
	const { text, title, author } = cleanSourceText(html, sourceType, quiet);

	const wordCount = text.trim().split(/\s+/).length;
	const charCount = text.length;
	const estimatedTokens = estimateTokens(text);
	const titleSlug = createSlug(title);

	const meta = {
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
		local_slug: titleSlug
	};

	return {
		text,
		titleSlug,
		meta,
		canonicalUrl: sourceIdentity.canonicalUrl,
		canonicalUrlHash: sourceIdentity.canonicalUrlHash
	};
}
