import type { HistoryEntry } from '$lib/components/panel/HistoryTab.svelte';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '@restormel/contracts/references';
import type { ReasoningEvaluation } from '@restormel/contracts/verification';
import type { ModelProvider, ReasoningProvider } from '@restormel/contracts/providers';
import type { GraphEdge, GraphNode, GraphSnapshotMeta } from '@restormel/contracts/api';
import { getIdToken } from '$lib/authClient';

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
  modelProvider?: ModelProvider;
  modelId?: string;
  domainMode?: 'auto' | 'manual';
  domain?: 'ethics' | 'philosophy_of_mind';
  resourceMode?: 'standard' | 'expanded';
  userLinks?: string[];
  linkPreferences?: Array<{
    url: string;
    ingest_selected: boolean;
    ingest_visibility: 'public_shared' | 'private_user_only';
    acknowledge_public_share?: boolean;
  }>;
  queueForNightlyIngest?: boolean;
}

interface CacheSearchOptions {
  depthMode?: 'quick' | 'standard' | 'deep';
  modelProvider?: ModelProvider;
  modelId?: string;
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
    selected_model_provider?: ModelProvider;
    selected_model_id?: string;
    resource_mode?: 'standard' | 'expanded';
    user_links_count?: number;
    runtime_links_processed?: number;
    nightly_queue_enqueued?: number;
    billing_tier?: 'free' | 'pro' | 'premium';
    billing_status?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';
    billing_currency?: 'GBP' | 'USD';
    entitlement_month_key?: string;
    ingestion_public_used?: number;
    ingestion_public_remaining?: number;
    ingestion_private_used?: number;
    ingestion_private_remaining?: number;
    ingestion_selected_count?: number;
    byok_wallet_currency?: 'GBP' | 'USD';
    byok_wallet_available_cents?: number;
    byok_fee_estimated_cents?: number;
    byok_fee_charged_cents?: number;
    byok_fee_charge_status?:
      | 'not_applicable'
      | 'pending'
      | 'shadow'
      | 'charged'
      | 'skipped'
      | 'insufficient';
    query_run_id?: string;
    model_cost_breakdown?: {
      total_estimated_cost_usd: number;
      by_model: Array<{
        provider: ReasoningProvider;
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
  graphSnapshot?: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    meta?: GraphSnapshotMeta;
    version?: number;
  };
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
  const modelId =
    String(options.modelId ?? '')
      .trim()
      .toLowerCase() || 'auto';
  const domainMode = options.domainMode ?? 'auto';
  const domain = normalizeDomain(domainMode, options.domain);
  const resourceMode = options.resourceMode ?? 'standard';
  const links = (options.userLinks ?? []).map((link) => link.trim()).filter(Boolean).sort();
  const linksKey = links.join('|') || 'none';
  const preferenceKey = (options.linkPreferences ?? [])
    .map((pref) => ({
      url: pref.url.trim(),
      ingest_selected: pref.ingest_selected === true ? '1' : '0',
      ingest_visibility:
        pref.ingest_visibility === 'private_user_only' ? 'private_user_only' : 'public_shared'
    }))
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((pref) => `${pref.url}|${pref.ingest_selected}|${pref.ingest_visibility}`)
    .join('::') || 'prefs:none';
  const queueKey = options.queueForNightlyIngest ? 'queue:yes' : 'queue:no';
  return `${normalizeQuery(query)}::${normalizeLens(options.lens)}::${depth}::${modelProvider}::${modelId}::${domainMode}::${domain}::${resourceMode}::${linksKey}::${preferenceKey}::${queueKey}`;
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
        modelProvider?: ModelProvider;
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

    findCachedResult(query: string, options?: CacheSearchOptions): CachedQueryResult | null {
      const normalized = normalizeQuery(query);
      const candidates = Object.values(cache)
        .filter((entry) => normalizeQuery(entry.query) === normalized)
        .sort((a, b) => new Date(b.cachedAt).getTime() - new Date(a.cachedAt).getTime());
      if (candidates.length === 0) return null;

      let narrowed = candidates;

      if (options?.depthMode) {
        const byDepth = narrowed.filter((entry) => (entry.metadata.depth_mode ?? 'standard') === options.depthMode);
        if (byDepth.length > 0) narrowed = byDepth;
      }

      if (options?.modelProvider) {
        const byProvider = narrowed.filter(
          (entry) => (entry.metadata.selected_model_provider ?? 'auto') === options.modelProvider
        );
        if (byProvider.length > 0) narrowed = byProvider;
      }

      if (String(options?.modelId ?? '').trim()) {
        const expectedModelId = String(options?.modelId ?? '')
          .trim()
          .toLowerCase();
        const byModel = narrowed.filter(
          (entry) => (entry.metadata.selected_model_id ?? '').trim().toLowerCase() === expectedModelId
        );
        if (byModel.length > 0) narrowed = byModel;
      }

      return narrowed[0] ?? null;
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
            modelProvider?: ModelProvider;
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
        // Never clobber a non-empty local history with an empty sync result.
        // This avoids perceived data loss during transient backend failures.
        if (serverItems.length === 0 && items.length > 0) {
          return;
        }

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
