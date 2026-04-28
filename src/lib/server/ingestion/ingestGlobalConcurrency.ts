import { getNeonPool } from '$lib/server/db/neon.js';

export type IngestGlobalConcurrencyKey = {
  provider: string;
  stage: string;
};

type ConcurrencyStats = {
  acquired: number;
  waitedMsTotal: number;
  waitedMsMax: number;
};

const stats = new Map<string, ConcurrencyStats>();

function statsKey(provider: string, stage: string): string {
  return `${provider}::${stage}`;
}

function bumpStats(provider: string, stage: string, waitedMs: number): void {
  const k = statsKey(provider, stage);
  const s = stats.get(k) ?? { acquired: 0, waitedMsTotal: 0, waitedMsMax: 0 };
  s.acquired += 1;
  s.waitedMsTotal += Math.max(0, waitedMs);
  s.waitedMsMax = Math.max(s.waitedMsMax, Math.max(0, waitedMs));
  stats.set(k, s);
}

export function formatIngestGlobalConcurrencySummaryLines(): string[] {
  const rows = Array.from(stats.entries())
    .map(([k, v]) => ({ k, ...v }))
    .sort((a, b) => b.waitedMsTotal - a.waitedMsTotal || b.acquired - a.acquired);
  if (rows.length === 0) return [];
  const out: string[] = [];
  out.push('  ─── Global concurrency waits (provider::stage) ───');
  for (const r of rows) {
    out.push(
      `    ${r.k.padEnd(28)} acquired=${String(r.acquired).padEnd(4)} waited_total_ms=${String(
        r.waitedMsTotal
      ).padEnd(7)} waited_max_ms=${r.waitedMsMax}`
    );
  }
  return out;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619 (with 32-bit overflow)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) | 0;
  }
  return hash | 0;
}

function parseYes(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(baseMs: number): number {
  const spread = Math.max(25, Math.floor(baseMs * 0.25));
  const r = Math.floor(Math.random() * (spread + 1));
  return baseMs - Math.floor(spread / 2) + r;
}

function globalLimitEnabled(): boolean {
  return !parseYes(process.env.INGEST_GLOBAL_CONCURRENCY_DISABLE);
}

function maxConcurrentForProvider(provider: string): number {
  const p = provider.trim().toLowerCase();
  const key = `INGEST_GLOBAL_MAX_CONCURRENT_${p.toUpperCase()}`;
  const raw = (process.env[key] ?? process.env.INGEST_GLOBAL_MAX_CONCURRENT_DEFAULT ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  // Default is tuned for "3 concurrent runs" without stampeding a single provider.
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.max(1, Math.min(16, Math.trunc(n)));
}

export function ingestGlobalConcurrencyEnabled(): boolean {
  return globalLimitEnabled() && !!process.env.DATABASE_URL?.trim();
}

export function ingestGlobalMaxConcurrentForProvider(provider: string): number {
  return maxConcurrentForProvider(provider);
}

function waitTimeoutMs(): number {
  // Must exceed typical long-running model call timeouts, otherwise workers will "fail closed"
  // under normal contention when max concurrency is small (e.g. 1).
  const raw = Number(process.env.INGEST_GLOBAL_CONCURRENCY_WAIT_MS ?? '900000');
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 900000;
}

function pollIntervalMs(): number {
  const raw = Number(process.env.INGEST_GLOBAL_CONCURRENCY_POLL_MS ?? '350');
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 350;
}

/**
 * Cross-process concurrency control using Postgres advisory locks.
 * Works across multiple ingest-worker processes sharing the same DATABASE_URL (Neon).
 */
export async function acquireIngestGlobalSlot(
  key: IngestGlobalConcurrencyKey
): Promise<{
  release: () => Promise<void>;
  slot: number;
  provider: string;
  stage: string;
  waitedMs: number;
}> {
  const provider = key.provider.trim().toLowerCase() || 'unknown';
  const stage = key.stage.trim().toLowerCase() || 'unknown';

  const logEnabled = parseYes(process.env.INGEST_GLOBAL_CONCURRENCY_LOG);

  if (!globalLimitEnabled() || !process.env.DATABASE_URL?.trim()) {
    return {
      slot: -1,
      provider,
      stage,
      waitedMs: 0,
      release: async () => {}
    };
  }

  const max = maxConcurrentForProvider(provider);
  const started = Date.now();
  const timeout = waitTimeoutMs();
  const basePoll = pollIntervalMs();

  // Spread contention across slots with a per-attempt start offset.
  let attempt = 0;

  while (Date.now() - started < timeout) {
    const startSlot = Math.floor(Math.random() * max);
    const pool = getNeonPool();
    const client = await pool.connect();
    let acquired = false;
    try {
      for (let i = 0; i < max; i++) {
        const slot = (startSlot + i) % max;
        const k1 = fnv1a32(`ingest_global:${provider}:${stage}`);
        const k2 = fnv1a32(`slot:${slot}`);
        const res = await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
          [k1, k2]
        );
        if (res.rows?.[0]?.locked) {
          const waitedMs = Date.now() - started;
          bumpStats(provider, stage, waitedMs);
          if (logEnabled) {
            console.log(
              `[INGEST_GLOBAL_CONCURRENCY] acquired provider=${provider} stage=${stage} slot=${slot}/${max} waited_ms=${waitedMs}`
            );
          }
          let released = false;
          acquired = true;
          return {
            slot,
            provider,
            stage,
            waitedMs,
            release: async () => {
              if (released) return;
              released = true;
              try {
                await client.query('SELECT pg_advisory_unlock($1::int, $2::int)', [k1, k2]);
                if (logEnabled) {
                  console.log(
                    `[INGEST_GLOBAL_CONCURRENCY] released provider=${provider} stage=${stage} slot=${slot}/${max}`
                  );
                }
              } catch {
                // best-effort unlock
              } finally {
                client.release();
              }
            }
          };
        }
      }
    } finally {
      // No slot acquired with this session; return it to the pool.
      if (!acquired) client.release();
    }

    attempt += 1;
    // Jitter increases with contention so 3+ workers de-sync instead of thundering herd.
    const wait = jitterMs(basePoll + Math.min(2000, attempt * 25));
    await sleep(wait);
  }

  throw new Error(
    `[INGEST_GLOBAL_CONCURRENCY] Timed out waiting for provider slot (provider=${provider} stage=${stage} max=${max} wait_ms=${timeout})`
  );
}

