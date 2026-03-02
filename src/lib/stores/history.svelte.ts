import type { HistoryEntry } from '$lib/components/panel/HistoryTab.svelte';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';

const STORAGE_KEY = 'sophia-history';
const CACHE_STORAGE_KEY = 'sophia-query-cache';
const MAX_CACHE_ENTRIES = 10;

interface CachedPassClaims {
  pass: AnalysisPhase;
  claims: Claim[];
}

interface CachedPassRelations {
  pass: AnalysisPhase;
  relations: RelationBundle[];
}

export interface CachedQueryResult {
  query: string;
  passes: { analysis: string; critique: string; synthesis: string; verification?: string };
  metadata: {
    total_input_tokens: number;
    total_output_tokens: number;
    duration_ms: number;
    claims_retrieved?: number;
    arguments_retrieved?: number;
    retrieval_degraded?: boolean;
    retrieval_degraded_reason?: string;
  };
  sources: SourceReference[];
  claimsByPass: CachedPassClaims[];
  relationsByPass: CachedPassRelations[];
  cachedAt: string;
}

function loadFromStorage(): HistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

function saveToStorage(entries: HistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function loadCacheFromStorage(): Record<string, CachedQueryResult> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CachedQueryResult>;
  } catch {
    return {};
  }
}

function saveCacheToStorage(cache: Record<string, CachedQueryResult>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function createHistoryStore() {
  let items = $state<HistoryEntry[]>(loadFromStorage());
  let cache = $state<Record<string, CachedQueryResult>>(loadCacheFromStorage());

  return {
    get items() { return items; },

    addEntry(question: string, passCount: number = 3): void {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        question,
        timestamp: new Date(),
        passCount,
      };
      items = [entry, ...items];
      saveToStorage(items);
    },

    clear(): void {
      items = [];
      saveToStorage(items);
    },

    getCachedResult(query: string): CachedQueryResult | null {
      const key = normalizeQuery(query);
      return cache[key] ?? null;
    },

    saveCachedResult(query: string, result: Omit<CachedQueryResult, 'query' | 'cachedAt'>): void {
      const key = normalizeQuery(query);

      cache = {
        ...cache,
        [key]: {
          ...result,
          query,
          cachedAt: new Date().toISOString()
        }
      };

      const sorted = Object.entries(cache).sort(
        (a, b) => new Date(b[1].cachedAt).getTime() - new Date(a[1].cachedAt).getTime()
      );

      cache = Object.fromEntries(sorted.slice(0, MAX_CACHE_ENTRIES));
      saveCacheToStorage(cache);
    },
  };
}

export const historyStore = createHistoryStore();
