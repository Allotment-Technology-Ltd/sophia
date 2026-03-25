import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
	buildIngestionStageUsageEstimates,
	type IngestionPlanningContext
} from '$lib/server/aaif/ingestion-plan';

const MAX_PREVIEW_BYTES = 180_000;
const FETCH_TIMEOUT_MS = 9000;
const SEP_ARCHINFO_TIMEOUT_MS = 6000;
const SEP_HOSTNAME = 'plato.stanford.edu';

function parsePositiveInt(value: string | null): number | null {
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value: string | null | undefined): string {
	return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePublicationYear(value: string | null | undefined): string {
	const match = (value ?? '').match(/\b(19|20)\d{2}\b/);
	return match ? match[0] : '';
}

function decodeBasicEntities(input: string): string {
	return input
		.replaceAll('&nbsp;', ' ')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&amp;', '&');
}

function normalizeInlineText(input: string): string {
	return decodeBasicEntities(input)
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseSepCitationCore(citationText: string | null): {
	title: string | null;
	author: string | null;
	year: string | null;
} {
	if (!citationText) return { title: null, author: null, year: null };
	const normalized = normalizeInlineText(citationText);
	if (!normalized) return { title: null, author: null, year: null };

	const titleMatch = normalized.match(/"([^"]+)"/);
	const title = titleMatch?.[1] ? normalizeText(titleMatch[1]) : null;

	const authorRaw = titleMatch?.index ? normalized.slice(0, titleMatch.index).replace(/,\s*$/, '') : '';
	const author = authorRaw ? normalizeText(authorRaw) : null;

	const yearMatch = normalized.match(/\b(19|20)\d{2}\b/);
	const year = yearMatch?.[0] ?? null;

	return { title, author, year };
}

function yearFromSepStableArchiveUrl(stableArchiveUrl: string | null): string | null {
	if (!stableArchiveUrl) return null;
	const match = stableArchiveUrl.match(/\/archives\/[^/]*?((?:19|20)\d{2})\//i);
	return match?.[1] ?? null;
}

function sepEntrySlugFromUrl(url: URL): string | null {
	if (url.hostname !== SEP_HOSTNAME) return null;
	const archInfoPath = '/cgi-bin/encyclopedia/archinfo.cgi';
	if (url.pathname === archInfoPath) {
		const entry = (url.searchParams.get('entry') ?? '').trim().toLowerCase();
		return /^[a-z0-9-]+$/.test(entry) ? entry : null;
	}

	const match = url.pathname.match(/\/entries\/([a-z0-9-]+)(?:\/|$)/i);
	if (!match?.[1]) return null;
	return match[1].toLowerCase();
}

async function fetchSepCitationInfo(entrySlug: string): Promise<{
	entrySlug: string;
	archiveInfoUrl: string;
	stableArchiveUrl: string | null;
	citationText: string | null;
	firstPublished: string | null;
	lastModified: string | null;
} | null> {
	const archiveInfoUrl = `https://${SEP_HOSTNAME}/cgi-bin/encyclopedia/archinfo.cgi?entry=${encodeURIComponent(entrySlug)}`;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), SEP_ARCHINFO_TIMEOUT_MS);
	try {
		const response = await fetch(archiveInfoUrl, {
			method: 'GET',
			redirect: 'follow',
			signal: controller.signal,
			headers: {
				'User-Agent': 'SophiaAdmin/1.0 (+https://usesophia.app)',
				Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1'
			}
		});
		if (!response.ok) return null;
		const html = await response.text();

		const stableArchiveUrlMatch = html.match(
			/URL\s*=\s*(?:&lt;|<)\s*(https?:\/\/plato\.stanford\.edu\/archives\/[^<>\s]+)\s*(?:&gt;|>)/i
		);
		const blockQuoteMatch = html.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i);
		const firstPublishedMatch = html.match(/first published on\s*([^.<]+(?:\.[^<]*)?)/i);
		const lastModifiedMatch = html.match(/last modified on\s*([^.<]+(?:\.[^<]*)?)/i);

		return {
			entrySlug,
			archiveInfoUrl,
			stableArchiveUrl: stableArchiveUrlMatch?.[1] ?? null,
			citationText: blockQuoteMatch?.[1] ? normalizeInlineText(blockQuoteMatch[1]) : null,
			firstPublished: firstPublishedMatch?.[1] ? normalizeInlineText(firstPublishedMatch[1]) : null,
			lastModified: lastModifiedMatch?.[1] ? normalizeInlineText(lastModifiedMatch[1]) : null
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
	}
}

function estimateTokensFromText(text: string): number {
	const words = normalizeText(text).split(/\s+/).filter(Boolean).length;
	if (words <= 0) return 0;
	return Math.ceil(words * 1.3);
}

function isBlockedHostname(hostnameRaw: string): boolean {
	const hostname = hostnameRaw.trim().toLowerCase();
	if (!hostname) return true;
	if (hostname === 'localhost' || hostname.endsWith('.local')) return true;

	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
		const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
		if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return true;
		if (parts[0] === 10) return true;
		if (parts[0] === 127) return true;
		if (parts[0] === 192 && parts[1] === 168) return true;
		if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
	}

	if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd')) return true;
	return false;
}

function titleFromUrl(url: URL): string {
	const parts = url.pathname.split('/').filter(Boolean);
	const raw = parts.at(-1) ?? url.hostname;
	return raw
		.replace(/\.[a-z0-9]+$/i, '')
		.replace(/[-_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/\b\w/g, (char) => char.toUpperCase())
		.trim();
}

async function readPreviewText(response: Response, maxBytes = MAX_PREVIEW_BYTES): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let text = '';
	try {
		while (total < maxBytes) {
			const { done, value } = await reader.read();
			if (done || !value) break;
			total += value.byteLength;
			text += decoder.decode(value, { stream: true });
			if (total >= maxBytes) break;
		}
		text += decoder.decode();
	} finally {
		try {
			await reader.cancel();
		} catch {
			// ignore cancellation errors
		}
	}
	return text;
}

function extractFromMetaTag(html: string, key: string): string {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
		new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
		new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, 'i'),
		new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i')
	];

	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (match?.[1]) return normalizeText(match[1]);
	}
	return '';
}

function extractGutenbergTableField(html: string, fieldLabel: string): string {
	const escaped = fieldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		new RegExp(
			`<tr[^>]*>[\\s\\S]*?<(?:th|td)[^>]*>\\s*${escaped}\\s*<\\/(?:th|td)>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>[\\s\\S]*?<\\/tr>`,
			'i'
		),
		new RegExp(
			`<(?:th|td)[^>]*>\\s*${escaped}\\s*<\\/(?:th|td)>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
			'i'
		)
	];
	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (match?.[1]) return normalizeInlineText(match[1]);
	}
	return '';
}

function extractGutenbergMetadata(html: string): {
	title: string;
	author: string;
	publicationYear: string;
} {
	const title = extractGutenbergTableField(html, 'Title');
	const authorRaw = extractGutenbergTableField(html, 'Author');
	const author = normalizeText(
		authorRaw
			.replace(/\b(19|20)\d{2}\s*-\s*(19|20)\d{2}\b/g, '')
			.replace(/\b(19|20)\d{2}\s*-\s*$/g, '')
			.replace(/,\s*$/g, '')
	);
	const publicationYear =
		normalizePublicationYear(extractGutenbergTableField(html, 'Release Date')) ||
		normalizePublicationYear(extractGutenbergTableField(html, 'Most Recently Updated')) ||
		normalizePublicationYear(authorRaw);

	return { title, author, publicationYear };
}

function extractPlainTextMetadata(
	text: string,
	pageUrl?: URL,
	sourceType?: string
): { title: string; author: string; publicationYear: string } {
	const lines = text
		.replace(/\r/g, '')
		.split('\n')
		.map((line) => normalizeText(line))
		.filter((line) => line.length > 0);

	let title = '';
	let author = '';
	let publicationYear = '';

	const titleLine = lines.find((line) => /^title:\s*/i.test(line));
	if (titleLine) {
		title = normalizeText(titleLine.replace(/^title:\s*/i, ''));
	}

	const authorLine = lines.find((line) => /^author:\s*/i.test(line));
	if (authorLine) {
		author = normalizeText(authorLine.replace(/^author:\s*/i, ''));
	}

	const releaseLine = lines.find((line) => /^release date:\s*/i.test(line));
	const updatedLine = lines.find((line) => /^most recently updated:\s*/i.test(line));
	publicationYear =
		normalizePublicationYear(releaseLine?.replace(/^release date:\s*/i, '') ?? '') ||
		normalizePublicationYear(updatedLine?.replace(/^most recently updated:\s*/i, '') ?? '');

	const useGutenbergParser =
		pageUrl?.hostname?.toLowerCase() === 'www.gutenberg.org' ||
		pageUrl?.hostname?.toLowerCase() === 'gutenberg.org' ||
		sourceType === 'book';
	if (useGutenbergParser) {
		if (!title) {
			const headerLine = lines.find((line) => /^the project gutenberg ebook of /i.test(line));
			if (headerLine) {
				const match = headerLine.match(/^the project gutenberg ebook of\s+(.+?)(?:\s+by\s+.+)?$/i);
				if (match?.[1]) title = normalizeText(match[1]);
			}
		}
		if (!publicationYear) {
			publicationYear = normalizePublicationYear(text);
		}
	}

	return { title, author, publicationYear };
}

function extractHtmlMetadata(
	html: string,
	pageUrl?: URL,
	sourceType?: string
): { title: string; author: string; publicationYear: string } {
	const titleMatch =
		html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
		html.match(/<title[^>]*>([^<]+)<\/title>/i);
	const genericTitle = normalizeText(titleMatch?.[1]);

	const genericAuthor =
		extractFromMetaTag(html, 'author') ||
		extractFromMetaTag(html, 'article:author') ||
		extractFromMetaTag(html, 'parsely-author');

	const genericPublicationYear =
		normalizePublicationYear(extractFromMetaTag(html, 'article:published_time')) ||
		normalizePublicationYear(extractFromMetaTag(html, 'citation_publication_date')) ||
		normalizePublicationYear(extractFromMetaTag(html, 'pubdate')) ||
		normalizePublicationYear(html);

	const useGutenbergExtractor =
		pageUrl?.hostname?.toLowerCase() === 'www.gutenberg.org' ||
		pageUrl?.hostname?.toLowerCase() === 'gutenberg.org' ||
		sourceType === 'book';
	if (!useGutenbergExtractor) {
		return { title: genericTitle, author: genericAuthor, publicationYear: genericPublicationYear };
	}

	const gutenberg = extractGutenbergMetadata(html);
	return {
		title: gutenberg.title || genericTitle,
		author: gutenberg.author || genericAuthor,
		publicationYear: gutenberg.publicationYear || genericPublicationYear
	};
}

export const POST: RequestHandler = async ({ request, locals }) => {
	assertAdminAccess(locals);

	const body = await request.json().catch(() => ({}));
	const urlInput = typeof body?.url === 'string' ? body.url.trim() : '';
	const sourceTypeInput = typeof body?.sourceType === 'string' ? body.sourceType.trim() : '';
	if (!urlInput) {
		return json({ error: 'Provide a URL to inspect.' }, { status: 400 });
	}

	let targetUrl: URL;
	try {
		targetUrl = new URL(urlInput);
	} catch {
		return json({ error: 'Invalid URL format.' }, { status: 400 });
	}

	if (!['http:', 'https:'].includes(targetUrl.protocol)) {
		return json({ error: 'Only http(s) URLs are supported.' }, { status: 400 });
	}
	if (isBlockedHostname(targetUrl.hostname)) {
		return json({ error: 'This host is blocked for metadata inspection.' }, { status: 400 });
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(targetUrl.toString(), {
			method: 'GET',
			redirect: 'follow',
			signal: controller.signal,
			headers: {
				'User-Agent': 'SophiaAdmin/1.0 (+https://usesophia.app)',
				Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1'
			}
		});

		if (!response.ok) {
			return json({ error: `Metadata request failed (${response.status}).` }, { status: 502 });
		}

		const finalUrl = response.url ? new URL(response.url) : targetUrl;
		const contentType = response.headers.get('content-type') ?? '';
		const contentLengthBytes = parsePositiveInt(response.headers.get('content-length'));
		const preview = await readPreviewText(response, MAX_PREVIEW_BYTES);
		const previewBytes = new TextEncoder().encode(preview).byteLength;
		const previewCharCount = preview.length;
		const previewTokenEstimate = estimateTokensFromText(preview);
		const extracted = contentType.includes('html')
			? extractHtmlMetadata(preview, finalUrl, sourceTypeInput)
			: extractPlainTextMetadata(preview, finalUrl, sourceTypeInput);
		const approxContentChars =
			typeof contentLengthBytes === 'number' && previewBytes > 0 && contentLengthBytes > previewBytes
				? Math.ceil(previewCharCount * (contentLengthBytes / previewBytes))
				: previewCharCount;
		const approxContentTokens =
			typeof contentLengthBytes === 'number' && previewBytes > 0 && contentLengthBytes > previewBytes
				? Math.ceil(previewTokenEstimate * (contentLengthBytes / previewBytes))
				: previewTokenEstimate;

		const context: IngestionPlanningContext = {
			sourceTitle: extracted.title || titleFromUrl(finalUrl),
			sourceType: sourceTypeInput || undefined,
			estimatedTokens: Math.max(approxContentTokens, 1),
			sourceLengthChars: Math.max(approxContentChars, 1)
		};
		const phaseEstimates = buildIngestionStageUsageEstimates(context);
		const sepSlug = sepEntrySlugFromUrl(finalUrl) ?? sepEntrySlugFromUrl(targetUrl);
		const sepCitation =
			(sourceTypeInput === 'sep_entry' || finalUrl.hostname === SEP_HOSTNAME) && sepSlug
				? await fetchSepCitationInfo(sepSlug)
				: null;
		const sepCitationCore = parseSepCitationCore(sepCitation?.citationText ?? null);
		const sepCitationYear = yearFromSepStableArchiveUrl(sepCitation?.stableArchiveUrl ?? null) ?? sepCitationCore.year;
		const resolvedTitle = sepCitationCore.title || extracted.title || titleFromUrl(finalUrl);
		const resolvedAuthor = sepCitationCore.author || extracted.author;
		const resolvedPublicationYear =
			sepCitationYear ||
			extracted.publicationYear ||
			normalizePublicationYear(finalUrl.toString());

		return json({
			metadata: {
				title: resolvedTitle,
				author: resolvedAuthor,
				publicationYear: resolvedPublicationYear,
				contentType,
				contentLengthBytes,
				finalUrl: finalUrl.toString(),
				hostname: finalUrl.hostname,
				sepCitation
			},
			preScan: {
				approxContentChars,
				approxContentTokens,
				previewChars: previewCharCount,
				previewTokens: previewTokenEstimate,
				phaseEstimates
			}
		});
	} catch (error) {
		const message =
			error instanceof Error && error.name === 'AbortError'
				? 'Metadata inspection timed out.'
				: error instanceof Error
					? error.message
					: 'Unable to inspect source metadata.';
		return json({ error: message }, { status: 502 });
	} finally {
		clearTimeout(timeoutId);
	}
};
