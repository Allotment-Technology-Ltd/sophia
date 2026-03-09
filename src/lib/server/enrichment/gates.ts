import type { EnrichmentCandidateEdge } from '$lib/types/enrichment';

export interface GateConfig {
  minEvidenceStrength: number;
  minConfidence: number;
  minNovelty: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  minEvidenceStrength: 0.45,
  minConfidence: 0.5,
  minNovelty: 0.2
};

export function hasCompleteProvenance(edge: EnrichmentCandidateEdge): boolean {
  return Boolean(
    edge.provenance?.id &&
      edge.provenance?.query_run_id &&
      edge.provenance?.pass_id &&
      edge.provenance?.timestamp &&
      edge.provenance?.rationale_text &&
      Array.isArray(edge.provenance?.source_refs) &&
      edge.provenance.source_refs.length > 0
  );
}

export function passesRelationSpecificGate(edge: EnrichmentCandidateEdge): boolean {
  if (edge.type === 'contradicts' || edge.type === 'qualifies') {
    return Boolean(edge.relation_rationale && edge.relation_rationale.length > 15);
  }
  return true;
}

export function shouldPromoteEdge(
  edge: EnrichmentCandidateEdge,
  config: GateConfig = DEFAULT_GATE_CONFIG
): { promote: boolean; reason?: string } {
  if (!hasCompleteProvenance(edge)) {
    return { promote: false, reason: 'incomplete_provenance' };
  }
  if ((edge.evidence_strength ?? 0) < config.minEvidenceStrength) {
    return { promote: false, reason: 'insufficient_evidence' };
  }
  if ((edge.relation_confidence ?? 0) < config.minConfidence) {
    return { promote: false, reason: 'insufficient_confidence' };
  }
  if ((edge.novelty_score ?? 0) < config.minNovelty) {
    return { promote: false, reason: 'low_novelty' };
  }
  if (!passesRelationSpecificGate(edge)) {
    return { promote: false, reason: 'relation_gate_failed' };
  }
  return { promote: true };
}
