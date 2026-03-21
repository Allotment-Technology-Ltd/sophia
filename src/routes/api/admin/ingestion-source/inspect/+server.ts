import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';

const MAX_PREVIEW_BYTES = 180_000;
const FETCH_TIMEOUT_MS = 9000;

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

function extractHtmlMetadata(html: string): { title: string; author: string; publicationYear: string } {
	const titleMatch =
		html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
		html.match(/<title[^>]*>([^<]+)<\/title>/i);
	const title = normalizeText(titleMatch?.[1]);

	const author =
		extractFromMetaTag(html, 'author') ||
		extractFromMetaTag(html, 'article:author') ||
		extractFromMetaTag(html, 'parsely-author');

	const publicationYear =
		normalizePublicationYear(extractFromMetaTag(html, 'article:published_time')) ||
		normalizePublicationYear(extractFromMetaTag(html, 'citation_publication_date')) ||
		normalizePublicationYear(extractFromMetaTag(html, 'pubdate')) ||
		normalizePublicationYear(html);

	return { title, author, publicationYear };
}

export const POST: RequestHandler = async ({ request, locals }) => {
	assertAdminAccess(locals);

	const body = await request.json().catch(() => ({}));
	const urlInput = typeof body?.url === 'string' ? body.url.trim() : '';
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
		const extracted = contentType.includes('html') ? extractHtmlMetadata(preview) : { title: '', author: '', publicationYear: '' };

		return json({
			metadata: {
				title: extracted.title || titleFromUrl(finalUrl),
				author: extracted.author,
				publicationYear: extracted.publicationYear || normalizePublicationYear(finalUrl.toString()),
				contentType,
				contentLengthBytes,
				finalUrl: finalUrl.toString(),
				hostname: finalUrl.hostname
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
