/**
 * Ingest model-pin helpers shared by `scripts/ingest.ts` (tsx, no SvelteKit) and `ingestRuns.ts`.
 * Must not import `$lib/*` — Cloud Run resolves ingest via `npx tsx` without Vite aliases.
 *
 * Vertex Gemini IDs: prefer current **Gemini 3.x** preview endpoints for new pins; map legacy 1.5 / 2.0 / 2.5
 * aliases so stored admin chains stay valid. See:
 * https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash
 * https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro
 * https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-flash-lite
 */

export const INGEST_PIN_STAGE_SUFFIXES = [
	'EXTRACTION',
	'RELATIONS',
	'GROUPING',
	'VALIDATION',
	'REMEDIATION',
	'JSON_REPAIR'
] as const;

/** Vertex / Google AI Studio model ids used as canonical ingest targets (public preview as of 2026). */
export const INGEST_VERTEX_GEMINI_FLASH_MODEL_ID = 'gemini-3-flash-preview';
export const INGEST_VERTEX_GEMINI_FLASH_LITE_MODEL_ID = 'gemini-3.1-flash-lite-preview';
export const INGEST_VERTEX_GEMINI_PRO_MODEL_ID = 'gemini-3.1-pro-preview';

/** Same rules as admin `modelChainLabelsToEnv` / `--ingest-pins-json`. */
export function normalizePinnedModelId(provider: string, modelId: string): string {
	const p = provider.toLowerCase().trim();
	const m = modelId.trim();
	if (p === 'anthropic' && m === 'claude-3-5-haiku') return 'claude-3-5-haiku-20241022';

	if (p === 'vertex' || p === 'google') {
		// Order: flash-lite before flash so `*-flash-lite` never matches `*-flash`.
		if (m === 'gemini-2.5-flash-lite') return INGEST_VERTEX_GEMINI_FLASH_LITE_MODEL_ID;
		if (m === 'gemini-2.5-flash') return INGEST_VERTEX_GEMINI_FLASH_MODEL_ID;
		if (m === 'gemini-2.5-pro') return INGEST_VERTEX_GEMINI_PRO_MODEL_ID;

		if (m === 'gemini-2.0-flash-lite' || m === 'gemini-2.0-flash-lite-001') {
			return INGEST_VERTEX_GEMINI_FLASH_LITE_MODEL_ID;
		}
		if (m === 'gemini-2.0-flash' || m === 'gemini-2.0-flash-001') {
			return INGEST_VERTEX_GEMINI_FLASH_MODEL_ID;
		}

		if (m === 'gemini-1.5-pro') return INGEST_VERTEX_GEMINI_PRO_MODEL_ID;
		if (m === 'gemini-1.5-flash') return INGEST_VERTEX_GEMINI_FLASH_MODEL_ID;
	}

	return m;
}

/** One-line summary for admin run logs / ingest stdout (no secrets). */
export function summarizeIngestPinsForLog(pinEnvFlat: Record<string, string>): string {
	const parts: string[] = [];
	for (const s of INGEST_PIN_STAGE_SUFFIXES) {
		const p = pinEnvFlat[`INGEST_PIN_PROVIDER_${s}`]?.trim();
		const m = pinEnvFlat[`INGEST_PIN_MODEL_${s}`]?.trim();
		if (p && m) parts.push(`${s}:${p}/${m}`);
	}
	return parts.length ? parts.join(' | ') : '(no parsed pins)';
}
