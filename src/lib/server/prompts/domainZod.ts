/**
 * Shared `domain` enum + Zod preprocess for extraction and grouping.
 * Models sometimes emit the allowed list as a JSON array instead of a single label; coerce safely.
 * Unknown but plausible strings map to `philosophy_general` so ingestion does not fail on new subfields.
 */

export const DOMAIN_VALUES = [
	'aesthetics',
	'applied_ethics',
	'comparative_philosophy',
	'epistemology',
	'ethics',
	'feminist_philosophy',
	'history_of_philosophy',
	'logic',
	'metaphilosophy',
	'metaphysics',
	'philosophy_general',
	'philosophy_of_ai',
	'philosophy_of_biology',
	'philosophy_of_language',
	'philosophy_of_law',
	'philosophy_of_mathematics',
	'philosophy_of_mind',
	'philosophy_of_religion',
	'philosophy_of_science',
	'philosophy_of_social_science',
	'political_philosophy'
] as const;

const DOMAIN_SET = new Set<string>(DOMAIN_VALUES);

function normalizeLabel(value: unknown): string | unknown {
	if (typeof value !== 'string') return value;
	return value.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

const domainMap: Record<string, (typeof DOMAIN_VALUES)[number]> = {
	aesthetics: 'aesthetics',
	applied_ethics: 'applied_ethics',
	bioethics: 'applied_ethics',
	comparative_philosophy: 'comparative_philosophy',
	comparative: 'comparative_philosophy',
	nonwestern_philosophy: 'comparative_philosophy',
	continental_philosophy: 'comparative_philosophy',
	epistemology: 'epistemology',
	ethics: 'ethics',
	moral_philosophy: 'ethics',
	normative_ethics: 'ethics',
	feminist_philosophy: 'feminist_philosophy',
	feminism: 'feminist_philosophy',
	history_of_philosophy: 'history_of_philosophy',
	ancient_philosophy: 'history_of_philosophy',
	medieval_philosophy: 'history_of_philosophy',
	early_modern_philosophy: 'history_of_philosophy',
	logic: 'logic',
	metaphilosophy: 'metaphilosophy',
	metaphysics: 'metaphysics',
	ontology: 'metaphysics',
	philosophy_general: 'philosophy_general',
	general_philosophy: 'philosophy_general',
	philosophy: 'philosophy_general',
	other: 'philosophy_general',
	misc: 'philosophy_general',
	philosophy_of_ai: 'philosophy_of_ai',
	philosophy_of_biology: 'philosophy_of_biology',
	philosophy_of_language: 'philosophy_of_language',
	philosophy_of_law: 'philosophy_of_law',
	jurisprudence: 'philosophy_of_law',
	legal_philosophy: 'philosophy_of_law',
	philosophy_of_mathematics: 'philosophy_of_mathematics',
	mathematics: 'philosophy_of_mathematics',
	philosophy_of_mind: 'philosophy_of_mind',
	mind: 'philosophy_of_mind',
	philosophy_of_religion: 'philosophy_of_religion',
	religion: 'philosophy_of_religion',
	theology: 'philosophy_of_religion',
	philosophy_of_science: 'philosophy_of_science',
	philosophy_of_social_science: 'philosophy_of_social_science',
	social_science: 'philosophy_of_social_science',
	political_philosophy: 'political_philosophy',
	social_philosophy: 'political_philosophy',
	phenomenology: 'metaphysics',
	existentialism: 'metaphysics'
};

/** Default when the model emits an unusable domain (e.g. empty array). */
const DOMAIN_FALLBACK: (typeof DOMAIN_VALUES)[number] = 'epistemology';

const UNKNOWN_DOMAIN: (typeof DOMAIN_VALUES)[number] = 'philosophy_general';

/**
 * Preprocess for `z.enum(DOMAIN_VALUES)`: single string, or array of candidates (models sometimes
 * paste the full enum list). Unknown labels become `philosophy_general`.
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
	if (typeof value !== 'string') return value;
	let normalized = normalizeLabel(value);
	if (typeof normalized !== 'string') return normalized;

	if (normalized.includes(',') || normalized.includes('|') || normalized.includes('/')) {
		const token = normalized
			.split(/[,|/]/)[0]
			?.trim()
			.replace(/[\s-]+/g, '_');
		if (token) return preprocessDomainForEnum(token);
	}

	let mapped = domainMap[normalized] ?? normalized;
	if (typeof mapped === 'string' && DOMAIN_SET.has(mapped)) return mapped;
	if (typeof mapped === 'string') {
		const hy = mapped.replace(/-/g, '_');
		if (DOMAIN_SET.has(hy)) return hy;
	}
	return UNKNOWN_DOMAIN;
}

/** Non-Zod callers (e.g. `scripts/ingest.ts` legacy normalizer) — always returns an allowed slug. */
export function coerceIngestDomainLabel(value: unknown): (typeof DOMAIN_VALUES)[number] {
	const v = preprocessDomainForEnum(value);
	if (typeof v === 'string' && DOMAIN_SET.has(v)) return v as (typeof DOMAIN_VALUES)[number];
	return UNKNOWN_DOMAIN;
}

/**
 * Older Surreal deployments used a minimal `claim.domain` ASSERT (11 values). Current
 * `DOMAIN_VALUES` is wider; ingestion can emit labels like `history_of_philosophy` that fail
 * inserts on those DBs. When `INGEST_SURREAL_DOMAIN_LEGACY_COMPAT=1`, map extended labels into
 * this legacy set before CREATE. Re-run `scripts/setup-schema.ts` (or widen ASSERT) to use the
 * full taxonomy instead of relying on this shim.
 */
export const SURREAL_LEGACY_V1_DOMAIN_VALUES = [
	'epistemology',
	'metaphysics',
	'ethics',
	'philosophy_of_mind',
	'political_philosophy',
	'logic',
	'aesthetics',
	'philosophy_of_science',
	'philosophy_of_language',
	'applied_ethics',
	'philosophy_of_ai'
] as const;

const LEGACY_V1_SET = new Set<string>(SURREAL_LEGACY_V1_DOMAIN_VALUES);

/** Maps expanded taxonomy → closest legacy bucket (best-effort). */
const DOMAIN_TO_LEGACY_V1: Partial<Record<(typeof DOMAIN_VALUES)[number], (typeof SURREAL_LEGACY_V1_DOMAIN_VALUES)[number]>> = {
	comparative_philosophy: 'political_philosophy',
	feminist_philosophy: 'ethics',
	history_of_philosophy: 'political_philosophy',
	metaphilosophy: 'metaphysics',
	philosophy_general: 'metaphysics',
	philosophy_of_biology: 'philosophy_of_science',
	philosophy_of_law: 'political_philosophy',
	philosophy_of_mathematics: 'logic',
	philosophy_of_religion: 'metaphysics',
	philosophy_of_social_science: 'political_philosophy'
};

/**
 * Returns a `domain` string safe for Surreal `claim.domain` ASSERT.
 * When legacy compat is off (default), returns the coerced taxonomy label.
 * When `process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT` is `1`/`true`/`yes`, maps into {@link SURREAL_LEGACY_V1_DOMAIN_VALUES}.
 */
export function claimDomainForSurrealStorage(
	value: unknown,
	env: NodeJS.ProcessEnv = process.env
): string {
	const coerced = coerceIngestDomainLabel(value);
	const legacy =
		(env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT ?? '').trim().toLowerCase() === '1' ||
		(env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT ?? '').trim().toLowerCase() === 'true' ||
		(env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT ?? '').trim().toLowerCase() === 'yes';
	if (!legacy) return coerced;
	if (LEGACY_V1_SET.has(coerced)) return coerced;
	const mapped = DOMAIN_TO_LEGACY_V1[coerced];
	return mapped ?? 'philosophy_of_mind';
}
