import { createHash } from 'node:crypto';

export interface CanonicalSourceIdentity {
	canonicalUrl: string;
	canonicalUrlHash: string;
}

export function canonicalizeSourceUrl(rawUrl: string): string | null {
	const trimmed = rawUrl.trim();
	if (!trimmed) return null;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return null;
	}

	parsed.hash = '';
	parsed.username = '';
	parsed.password = '';
	if (parsed.pathname.length > 1) {
		parsed.pathname = parsed.pathname.replace(/\/+$/, '');
	}

	return parsed.toString();
}

export function hashCanonicalUrl(canonicalUrl: string): string {
	return createHash('sha256').update(canonicalUrl).digest('hex');
}

export function canonicalizeAndHashSourceUrl(rawUrl: string): CanonicalSourceIdentity | null {
	const canonicalUrl = canonicalizeSourceUrl(rawUrl);
	if (!canonicalUrl) return null;

	return {
		canonicalUrl,
		canonicalUrlHash: hashCanonicalUrl(canonicalUrl)
	};
}
