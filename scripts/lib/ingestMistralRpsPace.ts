/**
 * Mistral chat RPS pacing for `scripts/ingest.ts` — Mistral dashboards show **per-model** caps
 * (e.g. mistral-medium ~0.42 RPS, mistral-large / codestral / devstral ~1 RPS, moderation higher).
 * Parallel extraction (`INGEST_EXTRACTION_CONCURRENCY` > 1) would otherwise issue multiple
 * in-flight requests and trip 429s even when TPM guard is unset.
 *
 * Env:
 * - `INGEST_MISTRAL_RPS_PACING` — default `1`; `0` / `false` / `off` disables (e.g. paid tier with headroom).
 * - `INGEST_MISTRAL_MIN_INTERVAL_MS` — optional **global** minimum gap (ms) between **starts** for **every** Mistral bucket.
 * - `INGEST_MISTRAL_PACE_INTERVAL_MS_<BUCKET>` — per-bucket override; bucket is UPPER_SNAKE of internal id, e.g.
 *   `INGEST_MISTRAL_PACE_INTERVAL_MS_MEDIUM`, `_LARGE`, `_MODERATION`, `_CODE`, `_SMALL`, `_OTHER`.
 */

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function pacingDisabled(): boolean {
	const v = (process.env.INGEST_MISTRAL_RPS_PACING ?? '1').trim().toLowerCase();
	return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

/** Last wall-clock start time per bucket (ms). */
const lastStartMs = new Map<string, number>();

/** Promise tail per bucket so concurrent callers serialize pacing. */
const tailByBucket = new Map<string, Promise<void>>();

export type MistralPaceBucket =
	| 'medium'
	| 'large'
	| 'moderation'
	| 'code'
	| 'small'
	| 'other';

const BUCKET_ENV_SUFFIX: Record<MistralPaceBucket, string> = {
	medium: 'MEDIUM',
	large: 'LARGE',
	moderation: 'MODERATION',
	code: 'CODE',
	small: 'SMALL',
	other: 'OTHER'
};

/** Default minimum ms between request **starts** (slightly under dashboard RPS). */
const DEFAULT_INTERVAL_MS: Record<MistralPaceBucket, number> = {
	// ~0.42 RPS → ~2380 ms; use 2650 for jitter / safety margin
	medium: 2650,
	// ~1 RPS large tier; use 1180 (~0.85 RPS) to leave slack for retries / clock skew
	large: 1180,
	// ~1.67 RPS moderation
	moderation: 680,
	// codestral / devstral cards: 1 RPS @ 50k TPM — treat like large tier
	code: 1180,
	// Unknown small / Nemo — stay conservative
	small: 2650,
	other: 2650
};

export function mistralPaceBucketForModel(modelId: string): MistralPaceBucket {
	const m = modelId.trim().toLowerCase();
	if (m.includes('medium')) return 'medium';
	if (m.includes('large')) return 'large';
	if (m.includes('moderation')) return 'moderation';
	if (m.includes('codestral') || m.includes('devstral')) return 'code';
	if (m.includes('small') || m.includes('nemo')) return 'small';
	return 'other';
}

function readGlobalIntervalOverride(): number | undefined {
	const n = Number(process.env.INGEST_MISTRAL_MIN_INTERVAL_MS);
	if (Number.isFinite(n) && n > 0) return Math.ceil(n);
	return undefined;
}

function readBucketIntervalOverride(bucket: MistralPaceBucket): number | undefined {
	const suf = BUCKET_ENV_SUFFIX[bucket];
	const n = Number(process.env[`INGEST_MISTRAL_PACE_INTERVAL_MS_${suf}`]);
	if (Number.isFinite(n) && n > 0) return Math.ceil(n);
	return undefined;
}

function resolveIntervalMs(modelId: string): { bucketKey: string; intervalMs: number } {
	const bucket = mistralPaceBucketForModel(modelId);
	const global = readGlobalIntervalOverride();
	const per = readBucketIntervalOverride(bucket);
	const base = DEFAULT_INTERVAL_MS[bucket];
	const interval = global ?? per ?? base;
	return { bucketKey: `mistral-pace:${bucket}`, intervalMs: Math.max(50, interval) };
}

/**
 * Wait until this Mistral **chat** call may start without exceeding the configured RPS envelope.
 * No-op when pacing disabled or for non-Mistral providers (caller should skip).
 */
export async function paceMistralChatCompletion(modelId: string): Promise<void> {
	if (pacingDisabled()) return;
	const { bucketKey, intervalMs } = resolveIntervalMs(modelId);
	const prev = tailByBucket.get(bucketKey) ?? Promise.resolve();
	const next = prev.then(async () => {
		const now = Date.now();
		const last = lastStartMs.get(bucketKey) ?? 0;
		const wait = Math.max(0, last + intervalMs - now);
		if (wait > 0) await sleep(wait);
		lastStartMs.set(bucketKey, Date.now());
	});
	tailByBucket.set(bucketKey, next.catch(() => {}));
	await next;
}
