import { createHash } from 'crypto';

export interface CanonicalSourceIdentity {
	canonicalUrl: string;
	canonicalUrlHash: string;
}

export const VALID_SOURCE_TYPES = [
	'book',
	'paper',
	'sep_entry',
	'iep_entry',
	'article',
	'institutional'
] as const;

const UNKNOWN_TITLE_VALUES = new Set([
	'',
	'unknown',
	'unknown title',
	'untitled',
	'n/a',
	'na',
	'null',
	'undefined'
]);

export function canonicalizeSourceUrl(rawUrl: string): string | null {
	const trimmed = rawUrl.trim();
	if (!trimmed) return null;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		return null;
	}

	parsed.hash = '';
	parsed.hostname = parsed.hostname.toLowerCase();

	if (
		(parsed.protocol === 'https:' && parsed.port === '443') ||
		(parsed.protocol === 'http:' && parsed.port === '80')
	) {
		parsed.port = '';
	}

	if (parsed.pathname.length > 1) {
		parsed.pathname = parsed.pathname.replace(/\/+$/, '');
	}

	if (parsed.search) {
		const entries = [...parsed.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => {
			const keyCmp = aKey.localeCompare(bKey);
			if (keyCmp !== 0) return keyCmp;
			return aValue.localeCompare(bValue);
		});
		parsed.search = '';
		for (const [key, value] of entries) {
			parsed.searchParams.append(key, value);
		}
	}

	return parsed.toString();
}

export function hashCanonicalUrl(canonicalUrl: string): string {
	return createHash('sha256').update(canonicalUrl).digest('hex');
}

export function deriveCanonicalSourceIdentity(rawUrl: string): CanonicalSourceIdentity | null {
	const canonicalUrl = canonicalizeSourceUrl(rawUrl);
	if (!canonicalUrl) return null;
	return {
		canonicalUrl,
		canonicalUrlHash: hashCanonicalUrl(canonicalUrl)
	};
}

export function normalizeSourceType(value: string | undefined | null): string {
	return String(value ?? '')
		.toLowerCase()
		.trim();
}

export function isValidSourceType(value: string | undefined | null): boolean {
	return (VALID_SOURCE_TYPES as readonly string[]).includes(normalizeSourceType(value));
}

export function isUnknownTitle(title: string | undefined | null): boolean {
	const normalized = String(title ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
	return UNKNOWN_TITLE_VALUES.has(normalized);
}
