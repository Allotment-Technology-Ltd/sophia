/**
 * Reconstruct ingest run LLM + embedding USD from `report_envelope.timingTelemetry`
 * (same shape as scripts/audit-ingest-cost-by-phase-neon.ts).
 */

import {
	estimateIngestLlmUsageUsd,
	INGEST_EMBED_USD_PER_MILLION_CHARS
} from './ingestLlmTokenUsdRates.js';

export const INGEST_TIMING_TOKEN_STAGES = [
	'extraction',
	'relations',
	'grouping',
	'validation',
	'remediation',
	'json_repair'
] as const;

type UnknownRecord = Record<string, unknown>;

function num(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const x = Number(v);
		return Number.isFinite(x) ? x : 0;
	}
	return 0;
}

function tokenMap(obj: unknown): Record<string, number> {
	const out: Record<string, number> = {};
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
	for (const [k, v] of Object.entries(obj as UnknownRecord)) {
		const n = num(v);
		if (n > 0) out[k] = n;
	}
	return out;
}

/**
 * Returns total USD from timing telemetry, or null if envelope has no usable timing block.
 */
export function computeIngestCostUsdFromReportEnvelope(envelope: unknown): number | null {
	if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
	const tt = (envelope as UnknownRecord).timingTelemetry;
	if (!tt || typeof tt !== 'object' || Array.isArray(tt)) return null;

	const sin = tokenMap((tt as UnknownRecord).stage_input_tokens);
	const sout = tokenMap((tt as UnknownRecord).stage_output_tokens);
	const sm = (tt as UnknownRecord).stage_models as UnknownRecord | undefined;

	let llmUsd = 0;
	let anyTokens = false;
	for (const st of INGEST_TIMING_TOKEN_STAGES) {
		const inn = sin[st] ?? 0;
		const outt = sout[st] ?? 0;
		if (inn > 0 || outt > 0) anyTokens = true;
		const modelRef =
			sm && typeof sm === 'object' && !Array.isArray(sm) && typeof sm[st] === 'string'
				? (sm[st] as string)
				: '';
		llmUsd += estimateIngestLlmUsageUsd(modelRef || 'unknown', inn, outt);
	}

	const vChars = num((tt as UnknownRecord).vertex_embed_chars);
	const embedUsd = vChars > 0 ? (vChars / 1_000_000) * INGEST_EMBED_USD_PER_MILLION_CHARS : 0;

	if (!anyTokens && embedUsd <= 0) return null;
	return llmUsd + embedUsd;
}
