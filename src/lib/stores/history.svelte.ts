import type { HistoryEntry } from '$lib/components/panel/HistoryTab.svelte';
import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';
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

function createHistoryStore() {
  let uid = $state<string | null>(null);
  let items = $state<HistoryEntry[]>([]);
  let cache = $state<Record<string, CachedQueryResult>>({});

  function historyStorageKey(): string | null {
    return uid ? `sophia-history-${uid}` : null;
  }

  function cacheStorageKey(): string | null {
    return uid ? `sophia-query-cache-${uid}` : null;
  }

  return {
    get items() { return items; },

    /**
     * Called on auth state change. Scopes all persistence to the given uid.
     * Pass null on sign-out — clears in-memory state so no data leaks between users.
     */
    setUid(newUid: string | null): void {
      uid = newUid;
      if (newUid) {
        items = loadFromStorage(`sophia-history-${newUid}`);
        cache = loadCacheFromStorage(`sophia-query-cache-${newUid}`);
      } else {
        items = [];
        cache = {};
      }
    },

    addEntry(question: string, passCount: number = 3): void {
      const key = historyStorageKey();
      if (!key) return;
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        question,
        timestamp: new Date(),
        passCount,
      };
      items = [entry, ...items];
      saveToStorage(items, key);
    },

    clear(): void {
      const key = historyStorageKey();
      items = [];
      if (key) saveToStorage(items, key);
    },

    getCachedResult(query: string): CachedQueryResult | null {
      const key = normalizeQuery(query);
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
          (e: { id: string; question: string; timestamp: string; passCount: number }) => ({
            id: e.id,
            question: e.question,
            timestamp: new Date(e.timestamp),
            passCount: e.passCount,
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

    saveCachedResult(query: string, result: Omit<CachedQueryResult, 'query' | 'cachedAt'>): void {
      const key = cacheStorageKey();
      if (!key) return;
      const normalKey = normalizeQuery(query);

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
