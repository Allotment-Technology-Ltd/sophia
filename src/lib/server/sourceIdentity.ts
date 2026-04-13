import { createHash } from 'node:crypto';

export interface CanonicalSourceIdentity {
	canonicalUrl: string;
	canonicalUrlHash: string;
}

/**
 * Lenient parse for operator-pasted URLs: trim, strip internal whitespace, fix Unicode hyphen lookalikes,
 * and normalize a few legacy SEP hostnames before `new URL`.
 */
export function tryParseIngestSourceUrl(rawUrl: string): URL | null {
	const collapsed = rawUrl.trim().replace(/\s+/g, '');
	if (!collapsed) return null;
	// Hyphen / dash confusables often appear when URLs are copied from PDFs or rich text.
	const candidate = collapsed.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-');
	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

	const host = parsed.hostname.toLowerCase();
	// Legacy / mirror links for Stanford Encyclopedia entries.
	if (host === 'web.stanford.edu' && /\/entries\//i.test(parsed.pathname)) {
		parsed.hostname = 'plato.stanford.edu';
	}
	if (host === 'seop.illemenau.de' || host === 'www.seop.illemenau.de') {
		parsed.hostname = 'plato.stanford.edu';
	}
	return parsed;
}

export function canonicalizeSourceUrl(rawUrl: string): string | null {
	const parsed = tryParseIngestSourceUrl(rawUrl);
	if (!parsed) return null;

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

/**
 * URL strings to try when downloading HTML (SEP and similar sites sometimes differ on trailing `/`,
 * and CDNs may behave differently for the raw pasted URL vs the canonical form).
 */
export function buildSourceUrlFetchCandidates(rawUrl: string): string[] {
	const trimmed = rawUrl.trim();
	const identity = canonicalizeAndHashSourceUrl(trimmed);
	const out: string[] = [];
	const push = (u: string | null | undefined) => {
		const t = u?.trim();
		if (!t) return;
		if (!out.includes(t)) out.push(t);
	};

	push(trimmed);
	if (identity) {
		push(identity.canonicalUrl);
		try {
			const parsed = new URL(identity.canonicalUrl);
			if (parsed.pathname.length > 1 && !parsed.pathname.endsWith('/')) {
				const withSlash = new URL(identity.canonicalUrl);
				withSlash.pathname = `${parsed.pathname}/`;
				push(withSlash.toString());
			} else if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
				const withoutSlash = new URL(identity.canonicalUrl);
				withoutSlash.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
				push(withoutSlash.toString());
			}
		} catch {
			// ignore
		}
	}

	return out;
}
