import type { HistoryEntry } from '$lib/components/panel/HistoryTab.svelte';

const STORAGE_KEY = 'sophia-history';

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

function createHistoryStore() {
  let items = $state<HistoryEntry[]>(loadFromStorage());

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
  };
}

export const historyStore = createHistoryStore();
