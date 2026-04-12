/**
 * Optional per-provider rolling token budgets to reduce TPM bursts before provider retries.
 * Env: INGEST_PROVIDER_TPM_BUDGET — comma list `provider:maxTokensPerWindow` (e.g. openai:800000,anthropic:400000).
 *       INGEST_PROVIDER_TPM_WINDOW_MS — window length in ms (default 60000).
 *
 * Mistral: dashboards often show **50k–600k TPM per SKU** with **≤1 RPS** on several tiers; chat pacing is handled
 * separately (`ingestMistralRpsPace.ts`). For tight **50k TPM** SKUs, add e.g.
 * `INGEST_PROVIDER_TPM_BUDGET=mistral:42000` so rolling usage stays under the minute cap across stages.
 */

type WindowEntry = { at: number; tokens: number };

function parseTpmBudgets(): Map<string, number> {
  const raw = (process.env.INGEST_PROVIDER_TPM_BUDGET || '').trim();
  const m = new Map<string, number>();
  if (!raw) return m;
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!s) continue;
    const idx = s.indexOf(':');
    if (idx <= 0) continue;
    const prov = s.slice(0, idx).trim().toLowerCase();
    const n = Number(s.slice(idx + 1).trim().replace(/_/g, ''));
    if (prov && Number.isFinite(n) && n > 0) m.set(prov, Math.floor(n));
  }
  return m;
}

export function createIngestProviderTpmGuard(): {
  waitForBudget: (provider: string, estimatedTokens: number) => Promise<void>;
  recordUsage: (provider: string, tokens: number) => void;
} {
  const budgets = parseTpmBudgets();
  const windowMs = Math.max(
    5_000,
    Math.min(600_000, Number(process.env.INGEST_PROVIDER_TPM_WINDOW_MS || '60000') || 60_000)
  );
  const windows = new Map<string, WindowEntry[]>();

  function prune(provider: string, now: number): WindowEntry[] {
    let arr = windows.get(provider);
    if (!arr) {
      arr = [];
      windows.set(provider, arr);
    }
    const cutoff = now - windowMs;
    while (arr.length > 0 && arr[0]!.at < cutoff) arr.shift();
    return arr;
  }

  function sumTokens(arr: WindowEntry[]): number {
    return arr.reduce((a, e) => a + e.tokens, 0);
  }

  async function waitForBudget(provider: string, estimatedTokens: number): Promise<void> {
    const prov = provider.trim().toLowerCase();
    const cap = budgets.get(prov);
    if (cap == null || estimatedTokens <= 0) return;

    for (;;) {
      const now = Date.now();
      const arr = prune(prov, now);
      const used = sumTokens(arr);
      if (used + estimatedTokens <= cap) return;
      if (arr.length === 0) return;
      const waitMs = Math.max(50, arr[0]!.at + windowMs - now);
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 5_000)));
    }
  }

  function recordUsage(provider: string, tokens: number): void {
    const prov = provider.trim().toLowerCase();
    if (tokens <= 0 || !budgets.has(prov)) return;
    const now = Date.now();
    const arr = prune(prov, now);
    arr.push({ at: now, tokens });
  }

  return { waitForBudget, recordUsage };
}
