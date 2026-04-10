/**
 * Classify durable job / ingest failures for auto-requeue policy (retryable vs permanent).
 */

export type IngestJobFailureKind = 'retryable' | 'permanent' | 'unknown';

const RETRYABLE_PATTERNS = [
	/429/,
	/rate\s*limit/i,
	/rate.?limit/i,
	/too\s+many\s+requests/i,
	/timeout/i,
	/timed?\s*out/i,
	/etimedout/i,
	/econnreset/i,
	/econnrefused/i,
	/socket\s+hang\s+up/i,
	/503/,
	/502/,
	/504/,
	/overload/i,
	/unavailable/i,
	/resource_exhausted/i,
	/try\s+again/i,
	/transient/i,
	/too\s+many\s+concurrent\s+ingest/i,
	/concurrent\s+ingest\s+workers/i,
	/ingest_stuck_timeout/i
];

const PERMANENT_PATTERNS = [
	/\b404\b/,
	/not\s+found/i,
	/\b400\b.*bad\s+request/i,
	/invalid\s+(api\s+)?key/i,
	/authentication/i,
	/unauthorized/i,
	/\b401\b/,
	/\b403\b/,
	/forbidden/i,
	/parse\s+impossible/i,
	/invalid\s+model/i,
	/model\s+not\s+found/i,
	/malformed/i,
	/unsupported\s+url/i,
	/unsupported\s+source/i,
	/pdf\s+files\s+cannot/i
];

export function classifyIngestJobErrorMessage(message: string | null | undefined): IngestJobFailureKind {
	const m = (message ?? '').trim();
	if (!m) return 'unknown';

	const lower = m.toLowerCase();
	for (const p of PERMANENT_PATTERNS) {
		if (p.test(lower)) return 'permanent';
	}
	for (const p of RETRYABLE_PATTERNS) {
		if (p.test(m)) return 'retryable';
	}
	return 'unknown';
}

/**
 * Auto-requeue only for clearly retryable failures (429, timeouts, overload, stuck, …).
 * Permanent (404, bad URL, …) never re-queue. Unknown errors re-queue only when
 * `INGEST_JOB_REQUEUE_UNKNOWN=1` (opt-in; default off).
 */
export function shouldAutoRequeueIngestJobItem(lastError: string | null | undefined): boolean {
	const k = classifyIngestJobErrorMessage(lastError);
	if (k === 'retryable') return true;
	if (k === 'permanent') return false;
	return (process.env.INGEST_JOB_REQUEUE_UNKNOWN ?? '').trim() === '1';
}

export function isLaunchThrottleError(message: string): boolean {
	const m = message.toLowerCase();
	return m.includes('too many concurrent ingest') || m.includes('concurrent ingest workers');
}

/** Exponential backoff for launch throttle (ms); capped. */
export function computeLaunchThrottleBackoffMs(throttleCount: number): number {
	const base = Math.max(
		250,
		Math.min(120_000, parseInt(process.env.INGEST_JOB_LAUNCH_BACKOFF_BASE_MS ?? '2000', 10) || 2000)
	);
	const n = Math.max(0, Math.min(12, throttleCount));
	const raw = base * Math.pow(2, Math.min(8, n));
	const cap = Math.min(600_000, parseInt(process.env.INGEST_JOB_LAUNCH_BACKOFF_MAX_MS ?? '600000', 10) || 600_000);
	const ms = Math.min(cap, raw);
	const jitter = Math.floor(Math.random() * Math.min(5000, Math.floor(ms * 0.15)));
	return ms + jitter;
}
