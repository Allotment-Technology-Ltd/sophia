/**
 * Groq Chat Completions RPS pacing for `scripts/ingest.ts`.
 * Free / Developer base tiers are often **~30 RPM** per model with tight TPM; parallel stages would
 * otherwise stack requests and trip 429s. See https://console.groq.com/docs/rate-limits
 *
 * Env:
 * - `INGEST_GROQ_RPS_PACING` — default `1`; `0` / `false` / `off` disables.
 * - `INGEST_GROQ_MIN_INTERVAL_MS` — optional global minimum gap (ms) between **starts** for every Groq bucket.
 * - `INGEST_GROQ_PACE_INTERVAL_MS_<BUCKET>` — per-bucket override; bucket is `RPM30` or `RPM60`.
 */

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function pacingDisabled(): boolean {
	const v = (process.env.INGEST_GROQ_RPS_PACING ?? '1').trim().toLowerCase();
	return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

const lastStartMs = new Map<string, number>();
const tailByBucket = new Map<string, Promise<void>>();

/** Groq published cards: many models 30 RPM; some (e.g. kimi-k2, qwen3-32b) 60 RPM on Developer table. */
export type GroqPaceBucket = 'rpm30' | 'rpm60';

const BUCKET_ENV_SUFFIX: Record<GroqPaceBucket, string> = {
	rpm30: 'RPM30',
	rpm60: 'RPM60'
};

/** ~30 RPM → ≥2s between starts; slight cushion. */
const DEFAULT_INTERVAL_MS: Record<GroqPaceBucket, number> = {
	rpm30: 2200,
	rpm60: 1100
};

export function groqPaceBucketForModel(modelId: string): GroqPaceBucket {
	const m = modelId.trim().toLowerCase();
	if (m.includes('kimi') || m.includes('qwen3')) return 'rpm60';
	return 'rpm30';
}

function readGlobalIntervalOverride(): number | undefined {
	const n = Number(process.env.INGEST_GROQ_MIN_INTERVAL_MS);
	if (Number.isFinite(n) && n > 0) return Math.ceil(n);
	return undefined;
}

function readBucketIntervalOverride(bucket: GroqPaceBucket): number | undefined {
	const suf = BUCKET_ENV_SUFFIX[bucket];
	const n = Number(process.env[`INGEST_GROQ_PACE_INTERVAL_MS_${suf}`]);
	if (Number.isFinite(n) && n > 0) return Math.ceil(n);
	return undefined;
}

function resolveIntervalMs(modelId: string): { bucketKey: string; intervalMs: number } {
	const bucket = groqPaceBucketForModel(modelId);
	const global = readGlobalIntervalOverride();
	const per = readBucketIntervalOverride(bucket);
	const base = DEFAULT_INTERVAL_MS[bucket];
	const interval = global ?? per ?? base;
	return { bucketKey: `groq-pace:${bucket}`, intervalMs: Math.max(50, interval) };
}

export async function paceGroqChatCompletion(modelId: string): Promise<void> {
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
