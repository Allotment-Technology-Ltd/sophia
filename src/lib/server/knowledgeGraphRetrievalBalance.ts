/**
 * Target mix for inquiry-time retrieval (Surreal graph), not operator dataset metrics.
 *
 * These ratios steer seed selection so answers draw from a balanced corpus: SEP vs Gutenberg
 * vs other origins, and roughly even representation across philosophical domains *present in the
 * candidate pool* (uniform among domains that actually appear — no Neon/historical counts).
 */

import type { PhilosophicalDomain } from '@restormel/contracts/domains';
import { inferSourceTypeFromUrl } from '$lib/server/ingestRuns';

export type RetrievalOriginBalanceKey = 'sep' | 'gutenberg' | 'other';

/** Default SEP / Gutenberg / other mix for seed claims (sums to 1). */
export const IDEAL_RETRIEVAL_ORIGIN_FRACTIONS: Record<RetrievalOriginBalanceKey, number> = {
	sep: 0.42,
	gutenberg: 0.33,
	other: 0.25
};

/** How strongly to up-rank underrepresented origins (higher = stricter balance). */
export const RETRIEVAL_ORIGIN_BALANCE_STRENGTH = 0.95;

/** How strongly to up-rank underrepresented domains among candidates (uniform target). */
export const RETRIEVAL_DOMAIN_BALANCE_STRENGTH = 0.85;

export function isRetrievalKgBalanceEnabled(): boolean {
	const v = (process.env.RETRIEVAL_KG_BALANCE ?? '1').trim().toLowerCase();
	return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

export function originBucketForRetrievalBalance(
	url: string | null | undefined,
	storedSourceType?: string | null
): RetrievalOriginBalanceKey {
	const u = (url ?? '').trim();
	if (!u) {
		const st = (storedSourceType ?? '').toLowerCase();
		if (st.includes('sep')) return 'sep';
		if (st.includes('gutenberg') || st === 'book' || st.includes('gutenberg_text')) return 'gutenberg';
		return 'other';
	}
	const inferred = inferSourceTypeFromUrl(u);
	if (inferred === 'sep_entry') return 'sep';
	if (inferred === 'book' || inferred === 'gutenberg_text') return 'gutenberg';
	return 'other';
}

function normalizeFractions<T extends string>(w: Record<T, number>): Record<T, number> {
	const sum = (Object.values(w) as number[]).reduce(
		(a, b) => a + (Number.isFinite(b) ? b : 0),
		0
	);
	if (sum <= 0) return { ...w };
	const out = {} as Record<T, number>;
	for (const k of Object.keys(w) as T[]) {
		out[k] = w[k] / sum;
	}
	return out;
}

/**
 * Multiplicative boost for MMR relevance (1 = neutral). Uses deficit vs ideal fractions.
 */
export function computeKgBalanceMultiplier(params: {
	origin: RetrievalOriginBalanceKey;
	domain: PhilosophicalDomain | string | null | undefined;
	selectedOriginCounts: Record<RetrievalOriginBalanceKey, number>;
	selectedDomainCounts: Map<string, number>;
	totalSelected: number;
	idealOrigin: Record<RetrievalOriginBalanceKey, number>;
	/** Domains present in the candidate pool (uniform target = 1 / size). */
	domainsInPool: Set<string>;
	originStrength?: number;
	domainStrength?: number;
}): number {
	const {
		origin,
		domain,
		selectedOriginCounts,
		selectedDomainCounts,
		totalSelected,
		idealOrigin,
		domainsInPool,
		originStrength = RETRIEVAL_ORIGIN_BALANCE_STRENGTH,
		domainStrength = RETRIEVAL_DOMAIN_BALANCE_STRENGTH
	} = params;

	if (totalSelected === 0) return 1;

	const idealO = normalizeFractions(idealOrigin);
	const curO = selectedOriginCounts[origin] / totalSelected;
	const tgtO = idealO[origin] ?? 0;
	const originMult =
		tgtO > 0 ? 1 + originStrength * Math.max(0, (tgtO - curO) / Math.max(0.08, tgtO)) : 1;

	let domainMult = 1;
	const nDom = domainsInPool.size;
	if (nDom > 1 && domain) {
		const dKey = String(domain);
		if (domainsInPool.has(dKey)) {
			const idealD = 1 / nDom;
			const curD = (selectedDomainCounts.get(dKey) ?? 0) / totalSelected;
			domainMult = 1 + domainStrength * Math.max(0, (idealD - curD) / Math.max(0.06, idealD));
		}
	}

	return Math.min(2.4, originMult * domainMult);
}
