import type { GraphEdge, GraphNode } from '$lib/types/api';
import type { AnalysisPhase, Claim, RelationBundle } from '$lib/types/references';
import type {
  EnrichmentCandidateEdge,
  EnrichmentCandidateNode,
  EnrichmentRunResult,
  ProvenanceRecord
} from '$lib/types/enrichment';
import { calibrateRelationConfidence } from './calibration';
import { hasCompleteProvenance, shouldPromoteEdge } from './gates';
import { extractFromSource } from './sourceExtractor';
import { promoteEnrichment, recordSnapshotLineage, stageEnrichment } from './store';

export interface DepthEnrichmentInput {
  query: string;
  queryRunId: string;
  parentSnapshotId?: string;
  passClaims: Partial<Record<AnalysisPhase, Claim[]>>;
  passRelations: Partial<Record<AnalysisPhase, RelationBundle[]>>;
  baseNodes: GraphNode[];
  baseEdges: GraphEdge[];
  retrieval: {
    claims_retrieved?: number;
    retrieval_degraded?: boolean;
  };
  groundingSources: Array<{ url: string; title?: string; pass: string }>;
}

function isEnabled(flag: string): boolean {
  return process.env[flag]?.toLowerCase() === 'true';
}

function makeId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function sourceCredibilityFromUrl(url?: string): number {
  if (!url) return 0.4;
  if (url.includes('.gov') || url.includes('.edu')) return 0.9;
  if (url.includes('stanford.edu') || url.includes('ox.ac.uk')) return 0.85;
  return 0.65;
}

function toCandidateNode(
  claim: Claim,
  queryRunId: string,
  pass: AnalysisPhase,
  sourceUrl?: string
): EnrichmentCandidateNode {
  const provenance: ProvenanceRecord = {
    id: makeId('prov'),
    query_run_id: queryRunId,
    pass_id: pass,
    timestamp: new Date().toISOString(),
    source_refs: [
      { kind: 'graph_claim', value: claim.id },
      ...(sourceUrl ? [{ kind: 'url' as const, value: sourceUrl }] : [])
    ],
    rationale_text: `Candidate node derived from ${pass} pass claim extraction.`,
    confidence_inputs: {
      extraction_confidence: claim.confidence ?? 0.5,
      source_credibility: sourceCredibilityFromUrl(sourceUrl),
      corroboration_count: sourceUrl ? 1 : 0,
      contradiction_pressure: 0,
      pass_agreement: 0.5
    }
  };

  return {
    id: `claim:${claim.id}`,
    type: 'claim',
    label: claim.text.slice(0, 80) + (claim.text.length > 80 ? '...' : ''),
    phase: pass,
    pass_origin: pass,
    depth_level: pass === 'analysis' ? 1 : pass === 'critique' ? 2 : 3,
    evidence_strength: sourceCredibilityFromUrl(sourceUrl),
    novelty_score: 0.7,
    derived_from: [claim.id],
    conflict_status: pass === 'critique' ? 'contested' : 'none',
    provenance_id: provenance.id,
    provenance
  };
}

function mapRelationType(type: string): GraphEdge['type'] {
  if (type === 'supports') return 'supports';
  if (type === 'contradicts') return 'contradicts';
  if (type === 'depends-on' || type === 'depends_on') return 'depends-on';
  if (type === 'responds-to' || type === 'responds_to') return 'responds-to';
  if (type === 'defines') return 'defines';
  if (type === 'qualifies') return 'qualifies';
  return 'supports';
}

function toCandidateEdges(
  bundles: RelationBundle[],
  queryRunId: string,
  pass: AnalysisPhase,
  defaultSourceUrl?: string
): EnrichmentCandidateEdge[] {
  const edges: EnrichmentCandidateEdge[] = [];

  for (const bundle of bundles) {
    for (const relation of bundle.relations) {
      const mappedType = mapRelationType(relation.type);
      const signals = {
        extractionConfidence: 0.65,
        sourceCredibility: sourceCredibilityFromUrl(defaultSourceUrl),
        corroborationCount: defaultSourceUrl ? 1 : 0,
        contradictionPressure: mappedType === 'contradicts' ? 0.3 : 0.1,
        passAgreement: pass === 'synthesis' ? 0.8 : 0.55
      };
      const calibrated = calibrateRelationConfidence(signals);
      const provenance: ProvenanceRecord = {
        id: makeId('prov'),
        query_run_id: queryRunId,
        pass_id: pass,
        timestamp: new Date().toISOString(),
        source_refs: [
          { kind: 'graph_claim', value: bundle.claimId },
          { kind: 'graph_claim', value: relation.target },
          ...(defaultSourceUrl ? [{ kind: 'url' as const, value: defaultSourceUrl }] : [])
        ],
        rationale_text: relation.label || `Relation candidate from ${pass} pass.`,
        confidence_inputs: {
          extraction_confidence: signals.extractionConfidence,
          source_credibility: signals.sourceCredibility,
          corroboration_count: signals.corroborationCount,
          contradiction_pressure: signals.contradictionPressure,
          pass_agreement: signals.passAgreement
        }
      };

      edges.push({
        from: bundle.claimId.startsWith('claim:') ? bundle.claimId : `claim:${bundle.claimId}`,
        to: relation.target.startsWith('claim:') ? relation.target : `claim:${relation.target}`,
        type: mappedType,
        phaseOrigin: pass,
        pass_origin: pass,
        depth_level: pass === 'analysis' ? 1 : pass === 'critique' ? 2 : 3,
        evidence_strength: signals.sourceCredibility,
        novelty_score: 0.6,
        derived_from: [bundle.claimId, relation.target],
        conflict_status:
          mappedType === 'contradicts'
            ? 'contested'
            : pass === 'synthesis' && mappedType === 'responds-to'
              ? 'resolved'
              : 'none',
        relation_rationale: relation.label,
        relation_confidence: calibrated.score,
        evidence_count: signals.corroborationCount,
        evidence_sources: defaultSourceUrl ? [defaultSourceUrl] : [],
        provenance_id: provenance.id,
        provenance
      });
    }
  }

  return edges;
}

function buildSequentialEdgesFromClaims(
  claims: Claim[],
  queryRunId: string,
  pass: AnalysisPhase,
  defaultSourceUrl?: string
): EnrichmentCandidateEdge[] {
  const edges: EnrichmentCandidateEdge[] = [];
  for (let i = 0; i < claims.length - 1; i += 1) {
    const from = claims[i];
    const to = claims[i + 1];
    const type: GraphEdge['type'] =
      pass === 'critique' ? 'contradicts' : pass === 'synthesis' ? 'responds-to' : 'supports';
    const calibrated = calibrateRelationConfidence({
      extractionConfidence: Math.min((from.confidence ?? 0.6), (to.confidence ?? 0.6)),
      sourceCredibility: sourceCredibilityFromUrl(defaultSourceUrl),
      corroborationCount: defaultSourceUrl ? 1 : 0,
      contradictionPressure: type === 'contradicts' ? 0.35 : 0.1,
      passAgreement: pass === 'synthesis' ? 0.75 : 0.55
    });
    const provenance: ProvenanceRecord = {
      id: makeId('prov'),
      query_run_id: queryRunId,
      pass_id: pass,
      timestamp: new Date().toISOString(),
      source_refs: [
        { kind: 'graph_claim', value: from.id },
        { kind: 'graph_claim', value: to.id },
        ...(defaultSourceUrl ? [{ kind: 'url' as const, value: defaultSourceUrl }] : [])
      ],
      rationale_text: `Sequential ${pass} chain edge generated to preserve support/attack flow.`,
      confidence_inputs: {
        extraction_confidence: calibrated.score,
        source_credibility: sourceCredibilityFromUrl(defaultSourceUrl),
        corroboration_count: defaultSourceUrl ? 1 : 0,
        contradiction_pressure: type === 'contradicts' ? 0.35 : 0.1,
        pass_agreement: pass === 'synthesis' ? 0.75 : 0.55
      }
    };

    edges.push({
      from: `claim:${from.id}`,
      to: `claim:${to.id}`,
      type,
      phaseOrigin: pass,
      pass_origin: pass,
      depth_level: pass === 'analysis' ? 1 : pass === 'critique' ? 2 : 3,
      evidence_strength: sourceCredibilityFromUrl(defaultSourceUrl),
      novelty_score: 0.35,
      derived_from: [from.id, to.id],
      conflict_status: type === 'contradicts' ? 'contested' : pass === 'synthesis' ? 'resolved' : 'none',
      relation_rationale: provenance.rationale_text,
      relation_confidence: calibrated.score,
      evidence_count: defaultSourceUrl ? 1 : 0,
      evidence_sources: defaultSourceUrl ? [defaultSourceUrl] : [],
      provenance_id: provenance.id,
      provenance
    });
  }
  return edges;
}

export async function runDepthEnrichment(input: DepthEnrichmentInput): Promise<EnrichmentRunResult> {
  const snapshotId = makeId('snapshot');
  const now = new Date().toISOString();

  if (!isEnabled('ENABLE_DEPTH_ENRICHMENT')) {
    return {
      status: 'suppressed',
      reason: 'feature_flag_disabled',
      stagedCount: 0,
      promotedCount: 0,
      queryRunId: input.queryRunId,
      snapshotId,
      parentSnapshotId: input.parentSnapshotId
    };
  }

  const sparseRetrieval = input.retrieval.retrieval_degraded || (input.retrieval.claims_retrieved ?? 0) < 3;

  let sourceTextCount = 0;
  if (isEnabled('ENABLE_TARGETED_SOURCE_INTAKE') && sparseRetrieval && input.groundingSources.length > 0) {
    const firstUrl = input.groundingSources[0]?.url;
    const mimeType = firstUrl?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/html';
    const extracted = await extractFromSource({
      url: firstUrl,
      mimeType,
      budget: { maxBytes: 350_000, maxLatencyMs: 2_000 }
    });
    sourceTextCount = extracted.text.length;
  }

  const defaultSourceUrl = input.groundingSources[0]?.url;
  const candidateNodes: EnrichmentCandidateNode[] = [];
  const candidateEdges: EnrichmentCandidateEdge[] = [];

  for (const pass of ['analysis', 'critique', 'synthesis'] as const) {
    const passClaimList = input.passClaims[pass] ?? [];
    for (const claim of passClaimList) {
      candidateNodes.push(toCandidateNode(claim, input.queryRunId, pass, claim.sourceUrl ?? defaultSourceUrl));
    }
    const explicitEdges = toCandidateEdges(
      input.passRelations[pass] ?? [],
      input.queryRunId,
      pass,
      defaultSourceUrl
    );
    candidateEdges.push(...explicitEdges);
    if (explicitEdges.length === 0 && passClaimList.length >= 2) {
      candidateEdges.push(
        ...buildSequentialEdgesFromClaims(passClaimList, input.queryRunId, pass, defaultSourceUrl)
      );
    }
  }

  if (candidateNodes.length === 0 && candidateEdges.length === 0) {
    return {
      status: 'suppressed',
      reason: sparseRetrieval ? 'weak_enrichment_data' : 'no_candidates',
      stagedCount: 0,
      promotedCount: 0,
      queryRunId: input.queryRunId,
      snapshotId,
      parentSnapshotId: input.parentSnapshotId
    };
  }

  const stageId = await stageEnrichment({
    query_run_id: input.queryRunId,
    snapshot_id: snapshotId,
    status: 'staged',
    reason: sparseRetrieval ? 'sparse_retrieval_gap_fill' : undefined,
    nodes: candidateNodes,
    edges: candidateEdges,
    created_at: now
  });

  const eligibleEdges = candidateEdges.filter((edge) => shouldPromoteEdge(edge).promote);
  const edgeNodeIds = new Set<string>(eligibleEdges.flatMap((edge) => [edge.from, edge.to]));
  const eligibleNodes = candidateNodes.filter((node) => {
    const baselineEligible =
      hasCompleteProvenance({
        ...node,
        from: node.id,
        to: node.id,
        type: 'supports',
        provenance: node.provenance
      } as EnrichmentCandidateEdge) &&
      (node.evidence_strength ?? 0) >= 0.45 &&
      (node.novelty_score ?? 0) >= 0.2;
    return baselineEligible || edgeNodeIds.has(node.id);
  });

  let promotedCount = 0;
  if (isEnabled('ENABLE_STAGING_PROMOTION') && stageId) {
    promotedCount = await promoteEnrichment(input.queryRunId, eligibleNodes, eligibleEdges);
  }

  const mergedNodes = [...input.baseNodes];
  const seenNodeIds = new Set(mergedNodes.map((node) => node.id));
  for (const node of eligibleNodes) {
    if (!seenNodeIds.has(node.id)) {
      mergedNodes.push(node);
      seenNodeIds.add(node.id);
    }
  }

  const mergedEdges = [...input.baseEdges, ...eligibleEdges];

  await recordSnapshotLineage({
    snapshot_id: snapshotId,
    query_run_id: input.queryRunId,
    parent_snapshot_id: input.parentSnapshotId,
    pass_sequence: 4,
    nodes: mergedNodes,
    edges: mergedEdges,
    created_at: now
  });

  const status: EnrichmentRunResult['status'] =
    promotedCount > 0 ? 'promoted' : stageId ? 'staged' : 'failed';

  return {
    status,
    reason:
      status === 'failed'
        ? 'staging_write_failed'
        : sparseRetrieval
          ? `sparse_retrieval_gap_fill:${sourceTextCount}`
          : undefined,
    stagedCount: candidateNodes.length + candidateEdges.length,
    promotedCount,
    queryRunId: input.queryRunId,
    snapshotId,
    parentSnapshotId: input.parentSnapshotId,
    snapshotNodes: mergedNodes,
    snapshotEdges: mergedEdges
  };
}
