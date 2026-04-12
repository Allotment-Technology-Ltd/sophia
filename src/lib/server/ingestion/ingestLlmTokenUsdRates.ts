/**
 * Token → USD estimates for ingestion LLM calls.
 *
 * `@restormel/keys` ships Google AI Studio pricing for a small GA Gemini set; Vertex preview IDs
 * such as `gemini-3-flash-preview` are absent there, which made ingest checkpoints and audits show ~$0.
 *
 * Supplemental rates follow **Vertex AI Generative AI — Standard** text pricing (USD per 1M tokens),
 * **≤200K input context** (longer contexts bill higher on GCP). Source of truth:
 * https://cloud.google.com/vertex-ai/generative-ai/pricing (Gemini 3 section; captured 2026-04-12).
 *
 * When `@restormel/keys` adds matching SKUs, those estimates take precedence (keys first, supplement second).
 */

import { estimateCost, defaultProviders } from '@restormel/keys';

/** Ingest script embedding path: Vertex / Voyage-style $/M characters (see scripts/ingest.ts). */
export const INGEST_EMBED_USD_PER_MILLION_CHARS = 0.025;

/** Identifier logged by Neon backfill for operators (not a DB constraint). */
export const INGEST_LLM_USD_RATE_TABLE_ID = 'vertex-gemini3-standard-2026-04-12' as const;

const SUPPLEMENTAL_VERTEX_GEMINI_TEXT_USD_PER_MILLION: Record<
	string,
	{ inputPerMillion: number; outputPerMillion: number }
> = {
	'gemini-3-flash-preview': { inputPerMillion: 0.5, outputPerMillion: 3 },
	'gemini-3.1-pro-preview': { inputPerMillion: 2, outputPerMillion: 12 },
	'gemini-3.1-flash-lite-preview': { inputPerMillion: 0.25, outputPerMillion: 1.5 },
	'gemini-3-pro-preview': { inputPerMillion: 2, outputPerMillion: 12 },
	'gemini-3.1-flash-image-preview': { inputPerMillion: 0.5, outputPerMillion: 3 },
	'gemini-3-pro-image-preview': { inputPerMillion: 2, outputPerMillion: 12 }
};

export function normalizeIngestBillingModelId(raw: string): string {
	let s = raw.trim();
	const slash = s.indexOf('/');
	if (slash >= 0) s = s.slice(slash + 1).trim();
	return s;
}

/**
 * Resolved $/1M input and $/1M output for a model id or `provider/model` ref.
 * Returns null only when neither Keys nor the Vertex Gemini 3 supplement has the model.
 */
export function getIngestLlmUsdPerMillion(modelRef: string): {
	inputPerMillion: number;
	outputPerMillion: number;
} | null {
	const trimmed = modelRef.trim();
	const id = normalizeIngestBillingModelId(trimmed);

	const fromKeys =
		estimateCost(id, defaultProviders) ?? estimateCost(trimmed, defaultProviders);
	if (fromKeys) {
		const inp = fromKeys.inputPerMillion ?? 0;
		const out = fromKeys.outputPerMillion ?? 0;
		if (inp > 0 || out > 0) {
			return { inputPerMillion: inp, outputPerMillion: out };
		}
	}

	const sup = SUPPLEMENTAL_VERTEX_GEMINI_TEXT_USD_PER_MILLION[id];
	if (sup) return sup;

	if (fromKeys) {
		return { inputPerMillion: fromKeys.inputPerMillion ?? 0, outputPerMillion: fromKeys.outputPerMillion ?? 0 };
	}
	return null;
}

export function estimateIngestLlmUsageUsd(
	modelRef: string,
	inputTokens: number,
	outputTokens: number
): number {
	const rates = getIngestLlmUsdPerMillion(modelRef);
	if (!rates) return 0;
	return (
		(rates.inputPerMillion * inputTokens + rates.outputPerMillion * outputTokens) / 1_000_000
	);
}

/** Sum of input+output $/1M used for catalog sort keys (legacy ingestCatalogRouting behaviour). */
export function ingestLlmCombinedUsdPer1MReference(modelId: string): number {
	const r = getIngestLlmUsdPerMillion(modelId);
	if (!r) return Number.POSITIVE_INFINITY;
	return r.inputPerMillion + r.outputPerMillion;
}
