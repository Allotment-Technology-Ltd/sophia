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
