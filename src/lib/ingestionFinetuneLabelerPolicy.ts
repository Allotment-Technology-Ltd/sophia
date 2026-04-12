/**
 * Fine-tune / training-data lineage: restrict which LLM providers may run stages whose
 * outputs are persisted as claims, relations, arguments, repairs, or remediated passages.
 *
 * Default is **strict** with an allowlist so Restormel resolve, catalog routing JSON, or
 * historical pins cannot silently reintroduce disallowed vendors (e.g. OpenAI/Anthropic) on
 * sensitive surfaces. **Mistral + Vertex** are allowed by default (canonical extraction is
 * Gemini-on-Vertex first with Mistral fallbacks; json_repair stays Mistral-primary).
 * Override with `INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS`. Disable locally with
 * `INGEST_FINETUNE_LABELER_STRICT=0`.
 */
import type { IngestionLlmStageKey } from './ingestionCanonicalPipeline.js';

/** Stages whose outputs are first-class training lineage (not cross-vendor validation). */
export const FINETUNE_SENSITIVE_LLM_STAGES = [
	'extraction',
	'relations',
	'grouping',
	'remediation',
	'json_repair'
] as const satisfies readonly IngestionLlmStageKey[];

export type FinetuneSensitiveLlmStage = (typeof FINETUNE_SENSITIVE_LLM_STAGES)[number];

export function ingestFinetuneLabelerStrictEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const v = (env.INGEST_FINETUNE_LABELER_STRICT ?? '1').trim().toLowerCase();
	if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
	return true;
}

/**
 * When strict mode is on, only these providers may appear in the effective model chain for
 * {@link FINETUNE_SENSITIVE_LLM_STAGES}. Default: `mistral`, `vertex` (Gemini-on-Vertex primaries
 * with Mistral fallbacks on sensitive stages per canonical pipeline).
 */
export function parseFinetuneLabelerAllowedProviders(env: NodeJS.ProcessEnv = process.env): string[] {
	const raw = env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS?.trim();
	if (!raw) return ['mistral', 'vertex'];
	return raw
		.split(/[,|]/)
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

export function isFinetuneSensitiveLlmStage(stage: string): stage is FinetuneSensitiveLlmStage {
	return (FINETUNE_SENSITIVE_LLM_STAGES as readonly string[]).includes(stage);
}

export function filterModelTiersForFinetunePolicy(
	stage: string,
	tiers: { provider: string; modelId: string }[],
	env: NodeJS.ProcessEnv = process.env
): { provider: string; modelId: string }[] {
	if (!ingestFinetuneLabelerStrictEnabled(env)) return tiers;
	if (!isFinetuneSensitiveLlmStage(stage)) return tiers;
	const allowed = new Set(parseFinetuneLabelerAllowedProviders(env));
	return tiers.filter((t) => allowed.has(t.provider.trim().toLowerCase()));
}
