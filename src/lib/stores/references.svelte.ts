import type { AnalysisPhase, Claim, RelationBundle, SourceReference } from '$lib/types/references';
import type { PassType } from '$lib/types/passes';
import type { GroundingSource } from '$lib/types/api';

const PHASE_ORDER: AnalysisPhase[] = ['analysis', 'critique', 'synthesis'];

function createReferencesStore() {
  let claims = $state<Claim[]>([]);
  let relations = $state<RelationBundle[]>([]);
  let sources = $state<SourceReference[]>([]);
  let groundingSources = $state<GroundingSource[]>([]);
  let isLive = $state(false);
  let currentPhase = $state<AnalysisPhase | null>(null);
  let groundingStatus = $state<Map<string, { grounded: boolean; supportingUris: string[] }>>(new Map());

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
    sources = [];
    groundingSources = [];
    isLive = false;
    currentPhase = null;
    groundingStatus = new Map();
  }

  function setSources(nextSources: SourceReference[]) {
    sources = nextSources;
  }

  function setGroundingSources(pass: PassType, newSources: GroundingSource[]) {
    groundingSources = [...groundingSources, ...newSources];
  }

  function getGroundingSourcesByPass(pass: PassType): GroundingSource[] {
    return groundingSources.filter(s => s.pass === pass);
  }

  function setLive(live: boolean) {
    isLive = live;
  }

  function setPhase(phase: AnalysisPhase | null) {
    currentPhase = phase;
  }

  function setGroundingStatus(claimId: string, status: { grounded: boolean; supportingUris: string[] }) {
    groundingStatus.set(claimId, status);
    groundingStatus = new Map(groundingStatus); // Trigger reactivity
  }

  function getGroundingStatus(claimId: string) {
    return groundingStatus.get(claimId);
  }

  function getAllClaims(): Claim[] {
    return claims;
  }

  return {
    get activeClaims() { return activeClaims; },
    get relations() { return relations; },
    get sources() { return sources; },
    get groundingSources() { return groundingSources; },
    get isLive() { return isLive; },
    get currentPhase() { return currentPhase; },
    get claimCount() { return claimCount; },
    get claimsPerPhase() { return claimsPerPhase; },
    addClaims,
    setSources,
    setGroundingSources,
    getGroundingSourcesByPass,
    reset,
    setLive,
    setPhase,
    setGroundingStatus,
    getGroundingStatus,
    getAllClaims,
  };
}

export const referencesStore = createReferencesStore();
