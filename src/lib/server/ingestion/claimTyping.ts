import {
	CLAIM_ORIGIN_VALUES,
	CLAIM_SCOPE_VALUES,
	type ClaimOrigin,
	type ClaimScope,
	type PassageRole
} from './contracts.js';

export interface ClaimTypingInput {
	text: string;
	claim_type: string;
	claim_origin?: string | null;
	subdomain?: string | null;
	thinker?: string | null;
	tradition?: string | null;
	era?: string | null;
	claim_scope?: string | null;
	concept_tags?: string[] | string | null;
}

export interface ClaimTypingContext {
	sourceTitle: string;
	sourceAuthors: string[];
	sourceYear?: number;
	passageRole?: PassageRole;
}

const CLAIM_ORIGIN_SET = new Set<string>(CLAIM_ORIGIN_VALUES);
const CLAIM_SCOPE_SET = new Set<string>(CLAIM_SCOPE_VALUES);
const UNKNOWN_AUTHOR_TOKENS = new Set(['unknown', 'anonymous']);

const AUTHOR_TRADITION_MAP: Array<{ pattern: RegExp; tradition: string; thinker: string }> = [
	{ pattern: /kant/i, tradition: 'Kantian', thinker: 'Kant' },
	{ pattern: /rawls/i, tradition: 'Liberal Egalitarian', thinker: 'Rawls' },
	{ pattern: /mill/i, tradition: 'Utilitarian', thinker: 'Mill' },
	{ pattern: /bentham/i, tradition: 'Utilitarian', thinker: 'Bentham' },
	{ pattern: /aristotle/i, tradition: 'Aristotelian', thinker: 'Aristotle' },
	{ pattern: /parfit/i, tradition: 'Analytic Ethics', thinker: 'Parfit' },
	{ pattern: /nagel/i, tradition: 'Analytic Philosophy', thinker: 'Nagel' },
	{ pattern: /plato/i, tradition: 'Platonic', thinker: 'Plato' },
	{ pattern: /hume/i, tradition: 'Empiricist', thinker: 'Hume' }
];

function normalizeLabel(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim().replace(/\s+/g, ' ');
	return normalized ? normalized : undefined;
}

function canonicalizeToken(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/[\s-]+/g, '_');
}

function normalizeClaimOrigin(value: string | null | undefined, passageRole?: PassageRole): ClaimOrigin {
	const normalized = value ? canonicalizeToken(value) : undefined;
	if (normalized && CLAIM_ORIGIN_SET.has(normalized)) {
		return normalized as ClaimOrigin;
	}
	if (passageRole === 'interpretive_commentary') return 'interpretive';
	return 'source_grounded';
}

function inferEra(sourceYear?: number): string | undefined {
	if (!sourceYear || !Number.isFinite(sourceYear)) return undefined;
	if (sourceYear < 500) return 'ancient';
	if (sourceYear < 1500) return 'medieval';
	if (sourceYear < 1800) return 'early_modern';
	if (sourceYear < 1950) return 'modern';
	return 'contemporary';
}

function inferThinkerAndTradition(sourceAuthors: string[]): { thinker?: string; tradition?: string } {
	for (const author of sourceAuthors) {
		for (const mapping of AUTHOR_TRADITION_MAP) {
			if (mapping.pattern.test(author)) {
				return { thinker: mapping.thinker, tradition: mapping.tradition };
			}
		}
	}
	return {};
}

function inferClaimScope(text: string, claimType: string, passageRole?: PassageRole): ClaimScope {
	const haystack = text.toLowerCase();
	if (claimType === 'empirical') return 'empirical';
	if (
		/\bought\b|\bshould\b|\bright\b|\bwrong\b|\bpermissible\b|\bobligation\b|\bduty\b/.test(
			haystack
		)
	) {
		return 'normative';
	}
	if (
		passageRole === 'interpretive_commentary' ||
		/\bphilosophy\b|\bmethod\b|\bargument\b|\bconceptual analysis\b|\bmetaphilosoph/.test(
			haystack
		)
	) {
		return 'metaphilosophical';
	}
	return 'descriptive';
}

function normalizeClaimScope(
	value: string | null | undefined,
	text: string,
	claimType: string,
	passageRole?: PassageRole
): ClaimScope {
	const normalized = value ? canonicalizeToken(value) : undefined;
	if (normalized && CLAIM_SCOPE_SET.has(normalized)) {
		return normalized as ClaimScope;
	}
	return inferClaimScope(text, claimType, passageRole);
}

function inferSubdomain(domain: string | undefined, text: string): string | undefined {
	if (!domain) return undefined;
	const haystack = text.toLowerCase();
	if (domain === 'ethics') {
		if (/\bmeaning of moral\b|\bmoral truth\b|\bobjectivity\b|\breasons? for action\b/.test(haystack)) {
			return 'metaethics';
		}
		if (/\babortion\b|\beuthanasia\b|\banimal\b|\bclimate\b|\bwar\b|\btriage\b/.test(haystack)) {
			return 'applied_ethics';
		}
		return 'normative_ethics';
	}
	if (domain === 'epistemology') {
		if (/\btestimony\b/.test(haystack)) return 'social_epistemology';
		if (/\bskeptic\b/.test(haystack)) return 'skepticism';
		if (/\bjustif/.test(haystack)) return 'justification';
		return 'knowledge';
	}
	if (domain === 'metaphysics') {
		if (/\bfree will\b/.test(haystack)) return 'free_will';
		if (/\bpersonal identity\b|\bidentity over time\b/.test(haystack)) return 'personal_identity';
		if (/\bpossible world\b|\bnecessary\b|\bmodal\b/.test(haystack)) return 'modality';
		return 'general_metaphysics';
	}
	if (domain === 'philosophy_of_mind') {
		if (/\bconscious/.test(haystack)) return 'consciousness';
		if (/\bintentional/.test(haystack)) return 'intentionality';
		if (/\bmental caus/.test(haystack)) return 'mental_causation';
		return 'mind_body';
	}
	if (domain === 'political_philosophy') {
		if (/\bpublic reason\b/.test(haystack)) return 'public_reason';
		if (/\bjustice\b|\bequality\b/.test(haystack)) return 'distributive_justice';
		return 'political_theory';
	}
	return domain;
}

export function detectContestedTerms(text: string): string[] {
	const patterns: Array<{ label: string; pattern: RegExp }> = [
		{ label: 'justice', pattern: /\bjustice\b/i },
		{ label: 'freedom', pattern: /\bfreedom\b|\bliberty\b/i },
		{ label: 'reason', pattern: /\breason\b|\brational\b/i },
		{ label: 'consciousness', pattern: /\bconscious(?:ness)?\b/i },
		{ label: 'identity', pattern: /\bidentity\b/i },
		{ label: 'autonomy', pattern: /\bautonomy\b/i },
		{ label: 'welfare', pattern: /\bwelfare\b|\butility\b/i },
		{ label: 'good', pattern: /\bthe good\b|\bgood\b/i }
	];
	return patterns.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

function normalizeConceptTags(value: string[] | string | null | undefined, text: string): string[] {
	const rawValues = Array.isArray(value)
		? value
		: typeof value === 'string'
			? value.split(',')
			: [];
	const normalized = rawValues
		.map((entry) => normalizeLabel(entry))
		.filter((entry): entry is string => Boolean(entry))
		.slice(0, 6);
	const fallbackTags = detectContestedTerms(text);
	return Array.from(new Set([...normalized, ...fallbackTags]));
}

export function deriveClaimTypingMetadata(
	input: ClaimTypingInput & { domain?: string },
	context: ClaimTypingContext
): {
	claim_origin: ClaimOrigin;
	subdomain?: string;
	thinker?: string;
	tradition?: string;
	era?: string;
	claim_scope: ClaimScope;
	attributed_to: string[];
	concept_tags: string[];
	contested_terms: string[];
} {
	const thinkerAndTradition = inferThinkerAndTradition(context.sourceAuthors);
	const attributedTo = context.sourceAuthors.filter(
		(author) => !UNKNOWN_AUTHOR_TOKENS.has(author.trim().toLowerCase())
	);

	return {
		claim_origin: normalizeClaimOrigin(input.claim_origin, context.passageRole),
		subdomain: normalizeLabel(input.subdomain) ?? inferSubdomain(input.domain, input.text),
		thinker: normalizeLabel(input.thinker) ?? thinkerAndTradition.thinker,
		tradition: normalizeLabel(input.tradition) ?? thinkerAndTradition.tradition,
		era: normalizeLabel(input.era) ?? inferEra(context.sourceYear),
		claim_scope: normalizeClaimScope(
			input.claim_scope,
			input.text,
			input.claim_type,
			context.passageRole
		),
		attributed_to: attributedTo,
		concept_tags: normalizeConceptTags(input.concept_tags, input.text),
		contested_terms: detectContestedTerms(input.text)
	};
}
