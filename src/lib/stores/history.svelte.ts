import type { HistoryEntry } from '$lib/components/panel/HistoryTab.svelte';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';
import type { ReasoningEvaluation } from '$lib/types/verification';
import { getIdToken } from '$lib/firebase';

const MAX_CACHE_ENTRIES = 10;

interface CachedPassClaims {
  pass: AnalysisPhase;
  claims: Claim[];
}

interface CachedPassRelations {
  pass: AnalysisPhase;
  relations: RelationBundle[];
}

interface CacheLookupOptions {
  lens?: string;
  depthMode?: 'quick' | 'standard' | 'deep';
  modelProvider?: 'auto' | 'vertex' | 'anthropic';
  modelId?: string;
  domainMode?: 'auto' | 'manual';
  domain?: 'ethics' | 'philosophy_of_mind';
  resourceMode?: 'standard' | 'expanded';
  userLinks?: string[];
  queueForNightlyIngest?: boolean;
}

export interface CachedQueryResult {
  query: string;
  lens?: string;
  domain_mode?: 'auto' | 'manual';
  domain?: 'ethics' | 'philosophy_of_mind';
  passes: { analysis: string; critique: string; synthesis: string; verification?: string };
  metadata: {
    total_input_tokens: number;
    total_output_tokens: number;
    duration_ms: number;
    claims_retrieved?: number;
    arguments_retrieved?: number;
    retrieval_degraded?: boolean;
    retrieval_degraded_reason?: string;
    depth_mode?: 'quick' | 'standard' | 'deep';
    selected_model_provider?: 'auto' | 'vertex' | 'anthropic';
    selected_model_id?: string;
    resource_mode?: 'standard' | 'expanded';
    user_links_count?: number;
    runtime_links_processed?: number;
    nightly_queue_enqueued?: number;
    query_run_id?: string;
    model_cost_breakdown?: {
      total_estimated_cost_usd: number;
      by_model: Array<{
        provider: 'vertex' | 'anthropic';
        model: string;
        passes: string[];
        input_tokens: number;
        output_tokens: number;
        input_cost_per_million: number;
        output_cost_per_million: number;
        estimated_cost_usd: number;
      }>;
    };
  };
  reasoningQuality?: ReasoningEvaluation;
  constitutionDeltas?: Array<{
    pass: 'analysis' | 'critique' | 'synthesis';
    introduced_violations: string[];
    resolved_violations: string[];
    unresolved_violations: string[];
    overall_compliance: 'pass' | 'partial' | 'fail';
  }>;
  sources: SourceReference[];
  claimsByPass: CachedPassClaims[];
  relationsByPass: CachedPassRelations[];
  cachedAt: string;
}

function loadFromStorage(key: string): HistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((e: HistoryEntry & { timestamp: string }) => ({
      ...e,
      timestamp: new Date(e.timestamp)
    }));
  } catch {
    return [];
  }
}

function saveToStorage(entries: HistoryEntry[], key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function loadCacheFromStorage(key: string): Record<string, CachedQueryResult> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CachedQueryResult>;
  } catch {
    return {};
  }
}

function saveCacheToStorage(cache: Record<string, CachedQueryResult>, key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function normalizeLens(lens?: string): string {
  return lens?.trim().toLowerCase() || 'none';
}

function normalizeDomain(mode: CacheLookupOptions['domainMode'], domain?: CacheLookupOptions['domain']): string {
  if (mode !== 'manual') return 'auto';
  return domain ?? 'auto';
}

function buildCacheKey(query: string, options?: CacheLookupOptions): string {
  if (!options) return normalizeQuery(query);
  const depth = options.depthMode ?? 'standard';
  const modelProvider = options.modelProvider ?? 'auto';
  const modelId = options.modelId?.trim().toLowerCase() ?? 'auto';
  const domainMode = options.domainMode ?? 'auto';
  const domain = normalizeDomain(domainMode, options.domain);
  const resourceMode = options.resourceMode ?? 'standard';
  const links = (options.userLinks ?? []).map((link) => link.trim()).filter(Boolean).sort();
  const linksKey = links.join('|') || 'none';
  const queueKey = options.queueForNightlyIngest ? 'queue:yes' : 'queue:no';
  return `${normalizeQuery(query)}::${normalizeLens(options.lens)}::${depth}::${modelProvider}::${modelId}::${domainMode}::${domain}::${resourceMode}::${linksKey}::${queueKey}`;
}

function createHistoryStore() {
  let uid = $state<string | null>(null);
  let items = $state<HistoryEntry[]>([]);
  let cache = $state<Record<string, CachedQueryResult>>({});

  function historyStorageKey(): string | null {
    return uid ? `sophia-history-${uid}` : 'sophia-history-local';
  }

  function cacheStorageKey(): string | null {
    return uid ? `sophia-query-cache-${uid}` : 'sophia-query-cache-local';
  }

  return {
    get items() { return items; },
    get cachedResults() {
      return Object.values(cache).sort(
        (a, b) => new Date(b.cachedAt).getTime() - new Date(a.cachedAt).getTime()
      );
    },

    /**
     * Called on auth state change. Scopes all persistence to the given uid.
     * Pass null on sign-out — clears in-memory state so no data leaks between users.
     */
    setUid(newUid: string | null): void {
      uid = newUid;
      const nextHistoryKey = newUid ? `sophia-history-${newUid}` : 'sophia-history-local';
      const nextCacheKey = newUid ? `sophia-query-cache-${newUid}` : 'sophia-query-cache-local';
      items = loadFromStorage(nextHistoryKey);
      cache = loadCacheFromStorage(nextCacheKey);
    },

    addEntry(
      question: string,
      options?: {
        passCount?: number;
        modelProvider?: 'auto' | 'vertex' | 'anthropic';
        modelId?: string;
        depthMode?: 'quick' | 'standard' | 'deep';
      }
    ): void {
      const key = historyStorageKey();
      if (!key) return;
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        question,
        timestamp: new Date(),
        passCount: options?.passCount ?? 3,
        modelProvider: options?.modelProvider,
        modelId: options?.modelId,
        depthMode: options?.depthMode
      };
      items = [entry, ...items];
      saveToStorage(items, key);
    },

    clear(): void {
      const key = historyStorageKey();
      items = [];
      if (key) saveToStorage(items, key);
    },

    getCachedResult(query: string, options?: CacheLookupOptions): CachedQueryResult | null {
      const key = buildCacheKey(query, options);
      return cache[key] ?? null;
    },

    /**
     * Fetches history from Firestore via /api/history and replaces in-memory items.
     * Falls back silently — localStorage data is shown until this resolves.
     */
    async syncFromServer(): Promise<void> {
      if (!uid) return;
      try {
        const token = await getIdToken();
        if (!token) return;

        const res = await fetch('/api/history', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;

        const data = await res.json();
        if (!Array.isArray(data.entries)) return;

        const serverItems: HistoryEntry[] = data.entries.map(
          (e: {
            id: string;
            question: string;
            timestamp: string;
            passCount: number;
            modelProvider?: 'auto' | 'vertex' | 'anthropic';
            modelId?: string;
            depthMode?: 'quick' | 'standard' | 'deep';
          }) => ({
            id: e.id,
            question: e.question,
            timestamp: new Date(e.timestamp),
            passCount: e.passCount,
            modelProvider: e.modelProvider,
            modelId: e.modelId,
            depthMode: e.depthMode
          })
        );

        items = serverItems;
        const key = historyStorageKey();
        if (key) saveToStorage(items, key);
      } catch {
        // silently fall back to localStorage data
      }
    },

    /**
     * Deletes a history entry by its Firestore doc ID.
     * Removes from local state immediately; fires DELETE request best-effort.
     */
    async deleteEntry(entryId: string): Promise<void> {
      items = items.filter(e => e.id !== entryId);
      const key = historyStorageKey();
      if (key) saveToStorage(items, key);

      if (!uid) return;
      try {
        const token = await getIdToken();
        if (!token) return;
        await fetch(`/api/history?id=${encodeURIComponent(entryId)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch {
        // best-effort — local state already updated
      }
    },

    saveCachedResult(
      query: string,
      result: Omit<CachedQueryResult, 'query' | 'cachedAt'>,
      options?: CacheLookupOptions
    ): void {
      const key = cacheStorageKey();
      if (!key) return;
      const normalKey = buildCacheKey(query, options);

      cache = {
        ...cache,
        [normalKey]: {
          ...result,
          query,
          cachedAt: new Date().toISOString()
        }
      };

      const sorted = Object.entries(cache).sort(
        (a, b) => new Date(b[1].cachedAt).getTime() - new Date(a[1].cachedAt).getTime()
      );

      cache = Object.fromEntries(sorted.slice(0, MAX_CACHE_ENTRIES));
      saveCacheToStorage(cache, key);
    },
  };
}

export const historyStore = createHistoryStore();
