import type { AnalysisPhase, Claim, RelationBundle } from '$lib/types/references';

const PHASE_ORDER: AnalysisPhase[] = ['analysis', 'critique', 'synthesis'];

function createReferencesStore() {
  let claims = $state<Claim[]>([]);
  let relations = $state<RelationBundle[]>([]);
  let isLive = $state(false);
  let currentPhase = $state<AnalysisPhase | null>(null);

  const activeClaims = $derived(
    [...claims].sort(
      (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase)
    )
  );

  const claimCount = $derived(claims.length);

  const claimsPerPhase = $derived(
    claims.reduce<Record<AnalysisPhase, number>>(
      (acc, c) => { acc[c.phase]++; return acc; },
      { analysis: 0, critique: 0, synthesis: 0 }
    )
  );

  function addClaims(phase: AnalysisPhase, newClaims: Claim[], newRelations: RelationBundle[]) {
    claims = [...claims, ...newClaims.map(c => ({ ...c, phase }))];
    relations = [...relations, ...newRelations];
  }

  function reset() {
    claims = [];
    relations = [];
    isLive = false;
    currentPhase = null;
  }

  function setLive(live: boolean) {
    isLive = live;
  }

  function setPhase(phase: AnalysisPhase | null) {
    currentPhase = phase;
  }

  return {
    get activeClaims() { return activeClaims; },
    get relations() { return relations; },
    get isLive() { return isLive; },
    get currentPhase() { return currentPhase; },
    get claimCount() { return claimCount; },
    get claimsPerPhase() { return claimsPerPhase; },
    addClaims,
    reset,
    setLive,
    setPhase,
  };
}

export const referencesStore = createReferencesStore();
