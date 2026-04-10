/**
 * Ingest model-pin helpers shared by `scripts/ingest.ts` (tsx, no SvelteKit) and `ingestRuns.ts`.
 * Must not import `$lib/*` — Cloud Run resolves ingest via `npx tsx` without Vite aliases.
 */

export const INGEST_PIN_STAGE_SUFFIXES = [
	'EXTRACTION',
	'RELATIONS',
	'GROUPING',
	'VALIDATION',
	'REMEDIATION',
	'JSON_REPAIR'
] as const;

/** Same rules as admin `modelChainLabelsToEnv` / `--ingest-pins-json`. */
export function normalizePinnedModelId(provider: string, modelId: string): string {
	const p = provider.toLowerCase().trim();
	const m = modelId.trim();
	if ((p === 'vertex' || p === 'google') && m === 'gemini-1.5-pro') return 'gemini-2.5-pro';
	if ((p === 'vertex' || p === 'google') && m === 'gemini-1.5-flash') return 'gemini-2.5-flash';
	// Retiring / legacy Vertex Gemini 2.x → current GA Flash (see Vertex model lifecycle docs).
	if ((p === 'vertex' || p === 'google') && (m === 'gemini-2.0-flash' || m === 'gemini-2.0-flash-001')) {
		return 'gemini-2.5-flash';
	}
	if (p === 'anthropic' && m === 'claude-3-5-haiku') return 'claude-3-5-haiku-20241022';
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
