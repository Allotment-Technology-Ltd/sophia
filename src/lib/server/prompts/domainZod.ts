/**
 * Shared `domain` enum + Zod preprocess for extraction and grouping.
 * Models sometimes emit the allowed list as a JSON array instead of a single label; coerce safely.
 */

export const DOMAIN_VALUES = [
	'ethics',
	'epistemology',
	'metaphysics',
	'philosophy_of_mind',
	'political_philosophy',
	'logic',
	'aesthetics',
	'philosophy_of_science',
	'philosophy_of_language',
	'applied_ethics',
	'philosophy_of_ai'
] as const;

const DOMAIN_SET = new Set<string>(DOMAIN_VALUES);

function normalizeLabel(value: unknown): string | unknown {
	if (typeof value !== 'string') return value;
	return value.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

const domainMap: Record<string, (typeof DOMAIN_VALUES)[number]> = {
	ethics: 'ethics',
	epistemology: 'epistemology',
	metaphysics: 'metaphysics',
	philosophy_of_mind: 'philosophy_of_mind',
	mind: 'philosophy_of_mind',
	political_philosophy: 'political_philosophy',
	logic: 'logic',
	aesthetics: 'aesthetics',
	philosophy_of_science: 'philosophy_of_science',
	philosophy_of_language: 'philosophy_of_language',
	applied_ethics: 'applied_ethics',
	philosophy_of_ai: 'philosophy_of_ai'
};

/** Default when the model emits an unusable domain (e.g. empty array). */
const DOMAIN_FALLBACK: (typeof DOMAIN_VALUES)[number] = 'epistemology';

/**
 * Preprocess for `z.enum(DOMAIN_VALUES)`: single string, or array of candidates (models sometimes
 * paste the full enum list).
 */
export function preprocessDomainForEnum(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const coerced = preprocessDomainForEnum(item);
			if (typeof coerced === 'string' && DOMAIN_SET.has(coerced)) return coerced;
		}
		return DOMAIN_FALLBACK;
	}
	const normalized = normalizeLabel(value);
	if (typeof normalized !== 'string') return normalized;
	const mapped = domainMap[normalized] ?? normalized;
	return mapped;
}
