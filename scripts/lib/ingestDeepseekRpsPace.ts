/**
 * DeepSeek Chat Completions RPS pacing for `scripts/ingest.ts`.
 *
 * Bursts from parallel extraction + validation + json_repair can otherwise stack and trip **429**
 * or transient overload on the shared API key (similar failure mode to Mistral free/busy tiers).
 *
 * Env:
 * - `INGEST_DEEPSEEK_RPS_PACING` — default `1`; `0` / `false` / `off` disables (e.g. paid tier with headroom).
 * - `INGEST_DEEPSEEK_MIN_INTERVAL_MS` — optional global minimum gap (ms) between **starts** for all DeepSeek calls.
 * - `INGEST_DEEPSEEK_PACE_INTERVAL_MS_CHAT` — `deepseek-chat` / `deepseek-coder` (default **900** ms).
 * - `INGEST_DEEPSEEK_PACE_INTERVAL_MS_REASONER` — `deepseek-reasoner` only (default **2200** ms; heavier SKU).
 */

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function pacingDisabled(): boolean {
	const v = (process.env.INGEST_DEEPSEEK_RPS_PACING ?? '1').trim().toLowerCase();
	return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

const lastStartMs = new Map<string, number>();
const tailByBucket = new Map<string, Promise<void>>();

export type DeepseekPaceBucket = 'reasoner' | 'chat';

const BUCKET_ENV_SUFFIX: Record<DeepseekPaceBucket, string> = {
	reasoner: 'REASONER',
	chat: 'CHAT'
};

/** Default minimum ms between request **starts** per bucket. */
const DEFAULT_INTERVAL_MS: Record<DeepseekPaceBucket, number> = {
	// Chat/coder: one conservative slot under typical ~10+ RPM class cards; stacks safely with multi-stage.
	chat: 900,
	// Reasoner class: fewer concurrent heavy calls; spacing avoids long-tail 429 + timeout pileups.
	reasoner: 2200
};

export function deepseekPaceBucketForModel(modelId: string): DeepseekPaceBucket {
	const m = modelId.trim().toLowerCase();
	if (m.includes('reasoner') || m.includes('r1')) return 'reasoner';
	return 'chat';
}

function readGlobalIntervalOverride(): number | undefined {
	const n = Number(process.env.INGEST_DEEPSEEK_MIN_INTERVAL_MS);
	if (Number.isFinite(n) && n > 0) return Math.ceil(n);
	return undefined;
}

function readBucketIntervalOverride(bucket: DeepseekPaceBucket): number | undefined {
	const suf = BUCKET_ENV_SUFFIX[bucket];
	const n = Number(process.env[`INGEST_DEEPSEEK_PACE_INTERVAL_MS_${suf}`]);
	if (Number.isFinite(n) && n > 0) return Math.ceil(n);
	return undefined;
}

function resolveIntervalMs(modelId: string): { bucketKey: string; intervalMs: number } {
	const bucket = deepseekPaceBucketForModel(modelId);
	const global = readGlobalIntervalOverride();
	const per = readBucketIntervalOverride(bucket);
	const base = DEFAULT_INTERVAL_MS[bucket];
	const interval = global ?? per ?? base;
	return { bucketKey: `deepseek-pace:${bucket}`, intervalMs: Math.max(50, interval) };
}

/**
 * Wait until this DeepSeek **chat** call may start without exceeding the configured RPS envelope.
 */
export async function paceDeepseekChatCompletion(modelId: string): Promise<void> {
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
