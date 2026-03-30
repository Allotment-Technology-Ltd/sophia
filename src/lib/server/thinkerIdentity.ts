export interface ThinkerIdentityCandidate {
	wikidata_id: string;
	name: string;
	confidence: number;
}

export interface ThinkerAutoLinkDecision {
	best: ThinkerIdentityCandidate | null;
	reason: 'ok' | 'below_threshold' | 'ambiguous' | 'empty';
}

export function canonicalizeThinkerName(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\(.*?\)/g, ' ')
		.replace(/\[.*?\]/g, ' ')
		.replace(/[.'"`]/g, ' ')
		.replace(/-/g, ' ')
		.toLowerCase()
		.replace(/\b(dr|prof|professor|sir|st|saint|fr|rev)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function tokenizeThinkerName(value: string): string[] {
	return canonicalizeThinkerName(value)
		.split(' ')
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

function firstLastSignature(tokens: string[]): string {
	if (tokens.length === 0) return '';
	if (tokens.length === 1) return tokens[0];
	return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

function initialLastSignature(tokens: string[]): string {
	if (tokens.length === 0) return '';
	if (tokens.length === 1) return tokens[0];
	return `${tokens[0][0]} ${tokens[tokens.length - 1]}`;
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) intersection += 1;
	}
	const union = a.size + b.size - intersection;
	return union > 0 ? intersection / union : 0;
}

export function estimateThinkerNameConfidence(author: string, thinkerName: string): number {
	const authorCanonical = canonicalizeThinkerName(author);
	const thinkerCanonical = canonicalizeThinkerName(thinkerName);
	if (!authorCanonical || !thinkerCanonical) return 0;
	if (authorCanonical === thinkerCanonical) return 1;

	const authorTokens = tokenizeThinkerName(author);
	const thinkerTokens = tokenizeThinkerName(thinkerName);
	if (authorTokens.length === 0 || thinkerTokens.length === 0) return 0;

	const authorFirstLast = firstLastSignature(authorTokens);
	const thinkerFirstLast = firstLastSignature(thinkerTokens);
	if (authorFirstLast && thinkerFirstLast && authorFirstLast === thinkerFirstLast) return 0.95;

	const authorInitialLast = initialLastSignature(authorTokens);
	const thinkerInitialLast = initialLastSignature(thinkerTokens);
	if (authorInitialLast && thinkerInitialLast && authorInitialLast === thinkerInitialLast) return 0.9;

	const authorSet = new Set(authorTokens);
	const thinkerSet = new Set(thinkerTokens);
	const overlapScore = jaccard(authorSet, thinkerSet);
	if (overlapScore >= 0.85) return 0.85;
	if (overlapScore >= 0.65) return 0.75;

	if (
		authorCanonical.includes(thinkerCanonical) ||
		thinkerCanonical.includes(authorCanonical) ||
		authorFirstLast.includes(thinkerFirstLast) ||
		thinkerFirstLast.includes(authorFirstLast)
	) {
		return 0.7;
	}

	const authorLast = authorTokens[authorTokens.length - 1];
	const thinkerLast = thinkerTokens[thinkerTokens.length - 1];
	if (authorLast && thinkerLast && authorLast === thinkerLast && overlapScore >= 0.34) {
		return 0.65;
	}

	return 0;
}

export function pickThinkerAutoLinkCandidate(
	candidates: ThinkerIdentityCandidate[],
	minConfidence: number,
	minDelta: number
): ThinkerAutoLinkDecision {
	if (candidates.length === 0) return { best: null, reason: 'empty' };
	const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
	const best = sorted[0];
	if (best.confidence < minConfidence) {
		return { best: null, reason: 'below_threshold' };
	}
	const second = sorted[1];
	if (second && best.confidence - second.confidence < minDelta) {
		return { best: null, reason: 'ambiguous' };
	}
	return { best, reason: 'ok' };
}
