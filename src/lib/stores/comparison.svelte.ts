import type { CachedQueryResult } from '$lib/stores/history.svelte';

export interface ComparisonBaseline {
  query: string;
  label: string;
  cached: CachedQueryResult;
  metadata: CachedQueryResult['metadata'];
  claimsByPass: CachedQueryResult['claimsByPass'];
  relationsByPass: CachedQueryResult['relationsByPass'];
  claimFingerprints: string[];
  relationFingerprints: string[];
  setAt: string;
}

function normalizeFingerprint(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value: string, max = 96): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function createComparisonStore() {
  let baseline = $state<ComparisonBaseline | null>(null);

  return {
    get baseline() {
      return baseline;
    },

    setBaselineFromCached(cached: CachedQueryResult, label: string): void {
      const claimById = new Map<string, string>();
      for (const pass of cached.claimsByPass) {
        for (const claim of pass.claims) {
          if (!claimById.has(claim.id)) {
            claimById.set(claim.id, claim.text);
          }
        }
      }

      const claimFingerprints = [...new Set(
        [...claimById.values()]
          .map((text) => normalizeFingerprint(clip(text)))
          .filter((fingerprint) => fingerprint.length > 0)
      )];

      const relationFingerprints: string[] = [];
      for (const pass of cached.relationsByPass) {
        for (const bundle of pass.relations) {
          const fromText = claimById.get(bundle.claimId);
          if (!fromText) continue;
          for (const relation of bundle.relations) {
            const toText = claimById.get(relation.target);
            if (!toText) continue;
            const fingerprint = normalizeFingerprint(
              `${clip(fromText)}|${relation.type}|${clip(toText)}`
            );
            if (fingerprint) relationFingerprints.push(fingerprint);
          }
        }
      }

      baseline = {
        query: cached.query,
        label,
        cached,
        metadata: cached.metadata,
        claimsByPass: cached.claimsByPass,
        relationsByPass: cached.relationsByPass,
        claimFingerprints,
        relationFingerprints: [...new Set(relationFingerprints)],
        setAt: new Date().toISOString()
      };
    },

    clear(): void {
      baseline = null;
    }
  };
}

export const comparisonStore = createComparisonStore();
