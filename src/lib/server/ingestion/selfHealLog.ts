/**
 * Structured console lines for self-healing ingestion signals.
 * Paired with classifyIngestLogLine in ingestRunIssues.ts (`[INGEST_SELF_HEAL]` prefix).
 */

export const INGEST_SELF_HEAL_PREFIX = '[INGEST_SELF_HEAL]';

/** Schema version for forward-compatible parsing in workers and reports. */
export type IngestSelfHealEventV1 = {
	v: 1;
	signal: 'recovery_agent' | 'circuit_open' | 'stage_health_bump';
	/** Pipeline stage when applicable: extraction, relations, grouping, validation, … */
	stage?: string;
	provider?: string;
	model?: string;
	/** Short outcome or action: e.g. proceed, sleep_retry, skipped_tier */
	outcome?: string;
	/** Truncated operator-safe detail (no secrets) */
	detail?: string;
};

export function formatIngestSelfHealLine(event: IngestSelfHealEventV1): string {
	return `${INGEST_SELF_HEAL_PREFIX} ${JSON.stringify(event)}`;
}

export function parseIngestSelfHealLine(line: string): IngestSelfHealEventV1 | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith(INGEST_SELF_HEAL_PREFIX)) return null;
	const jsonPart = trimmed.slice(INGEST_SELF_HEAL_PREFIX.length).trim();
	try {
		const parsed = JSON.parse(jsonPart) as unknown;
		if (typeof parsed !== 'object' || parsed === null) return null;
		const o = parsed as Record<string, unknown>;
		if (o.v !== 1) return null;
		const signal = o.signal;
		if (
			signal !== 'recovery_agent' &&
			signal !== 'circuit_open' &&
			signal !== 'stage_health_bump'
		) {
			return null;
		}
		return {
			v: 1,
			signal,
			stage: typeof o.stage === 'string' ? o.stage : undefined,
			provider: typeof o.provider === 'string' ? o.provider : undefined,
			model: typeof o.model === 'string' ? o.model : undefined,
			outcome: typeof o.outcome === 'string' ? o.outcome : undefined,
			detail: typeof o.detail === 'string' ? o.detail : undefined
		};
	} catch {
		return null;
	}
}
