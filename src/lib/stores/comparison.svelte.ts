import type { CachedQueryResult } from '$lib/stores/history.svelte';

export interface ComparisonBaseline {
  query: string;
  label: string;
  metadata: CachedQueryResult['metadata'];
  claimsByPass: CachedQueryResult['claimsByPass'];
  relationsByPass: CachedQueryResult['relationsByPass'];
  setAt: string;
}

function createComparisonStore() {
  let baseline = $state<ComparisonBaseline | null>(null);

  return {
    get baseline() {
      return baseline;
    },

    setBaselineFromCached(cached: CachedQueryResult, label: string): void {
      baseline = {
        query: cached.query,
        label,
        metadata: cached.metadata,
        claimsByPass: cached.claimsByPass,
        relationsByPass: cached.relationsByPass,
        setAt: new Date().toISOString()
      };
    },

    clear(): void {
      baseline = null;
    }
  };
}

export const comparisonStore = createComparisonStore();
