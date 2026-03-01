import * as fs from 'fs';
import * as path from 'path';
import { parse as parseHTML } from 'node-html-parser';

const VALID_SOURCE_TYPES = ['sep_entry', 'iep_entry', 'book', 'paper', 'institutional'];
const DATA_SOURCES_DIR = './data/sources';

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

/**
 * Fetch URL content
 */
async function fetchUrl(url: string): Promise<string> {
	console.log(`[FETCH] Downloading from ${url}...`);
	try {
		const response = await fetch(url);
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
		// Guard against accidentally fetching binary PDF data served without correct content-type
		if (html.startsWith('%PDF')) {
			throw new Error(
				'Response is a PDF file (detected by content). Update the source URL to an HTML version.'
			);
		}
		console.log(`[FETCH] Downloaded ${html.length.toLocaleString()} bytes`);
		return html;
	} catch (error) {
		throw new Error(`Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Extract Stanford Encyclopedia of Philosophy entry
 */
function extractSepEntry(html: string): { text: string; title: string; author: string[] } {
	const root = parseHTML(html);

	// Find main article content
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
	return { text, title, author };
}

/**
 * Extract Internet Encyclopedia of Philosophy entry
 */
function extractIepEntry(html: string): { text: string; title: string; author: string[] } {
	const root = parseHTML(html);

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
function extractGutenbergText(html: string): { text: string; title: string; author: string[] } {
	// Project Gutenberg texts have START and END markers
	const startMatch = html.match(/\*\*\*\s*START.+?\*\*\*/s);
	const endMatch = html.match(/\*\*\*\s*END.+?\*\*\*/s);

	let text = html;
	if (startMatch && endMatch) {
		text = html.substring(startMatch.index! + startMatch[0].length, endMatch.index);
	}

	// Try to extract title and author from Project Gutenberg header
	const titleMatch = html.match(/^Title:\s*(.+?)$/m);
	const authorMatch = html.match(/^Author:\s*(.+?)$/m);

	const title = titleMatch ? titleMatch[1].trim() : 'Unknown Title';
	const author = authorMatch ? [authorMatch[1].trim()] : [];

	return { text: text.trim(), title, author };
}

/**
 * Extract generic HTML content
 */
function extractGenericContent(
	html: string,
	sourceType: string
): { text: string; title: string; author: string[] } {
	const root = parseHTML(html);

	// Try common content selectors
	let mainContent =
		root.querySelector('article') ||
		root.querySelector('.content') ||
		root.querySelector('main') ||
		root.querySelector('.article');

	if (!mainContent) {
		throw new Error('Could not find main content in page');
	}

	// Remove navigation and boilerplate
	mainContent.querySelectorAll('nav, header, footer, .nav, .sidebar').forEach((n) => {
		n.remove();
	});

	const titleNode = root.querySelector('h1, .title');
	const title = titleNode?.text || 'Unknown Title';

	const authorNode = root.querySelector('.author, [rel="author"]');
	const author = authorNode ? [authorNode.text] : [];

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
		// Fetch the URL
		const html = await fetchUrl(url);

		// Clean and extract
		const { text, title, author } = cleanSourceText(html, sourceType);

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
			url,
			fetched_at: new Date().toISOString(),
			word_count: wordCount,
			char_count: charCount,
			estimated_tokens: estimatedTokens
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
		console.log(`URL: ${url}`);
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
