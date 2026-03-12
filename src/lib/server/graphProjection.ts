import type { RetrievalResult } from './retrieval';
import type { GraphNode, GraphEdge, GraphGhostNode, GraphGhostEdge, GraphSnapshotMeta } from '$lib/types/api';

/**
 * Project retrieval result into graph visualization format.
 * Creates nodes for sources and claims, edges for relationships.
 */
export function projectRetrievalToGraph(retrieval: RetrievalResult): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphSnapshotMeta;
} {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const rejectedNodes: GraphGhostNode[] = [];
  const rejectedEdges: GraphGhostEdge[] = [];
  const sourceIds = new Set<string>();
  const seedClaimIds = new Set(retrieval.seed_claim_ids);
  const traversedNodeIds: string[] = [];
  const adjacency = new Map<string, Set<string>>();
  const claimDepth = new Map<string, number>();

  for (const seedId of retrieval.seed_claim_ids) {
    claimDepth.set(seedId, 0);
  }

  for (const relation of retrieval.relations) {
    const fromClaim = retrieval.claims[relation.from_index];
    const toClaim = retrieval.claims[relation.to_index];
    if (!fromClaim || !toClaim) continue;
    if (!adjacency.has(fromClaim.id)) adjacency.set(fromClaim.id, new Set());
    if (!adjacency.has(toClaim.id)) adjacency.set(toClaim.id, new Set());
    adjacency.get(fromClaim.id)?.add(toClaim.id);
    adjacency.get(toClaim.id)?.add(fromClaim.id);
  }

  const queue: string[] = [...retrieval.seed_claim_ids];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const currentDepth = claimDepth.get(current) ?? 0;
    for (const neighbor of adjacency.get(current) ?? []) {
      const seenDepth = claimDepth.get(neighbor);
      if (seenDepth !== undefined && seenDepth <= currentDepth + 1) continue;
      claimDepth.set(neighbor, currentDepth + 1);
      queue.push(neighbor);
    }
  }

  // Create source nodes
  for (const claim of retrieval.claims) {
    const sourceId = `source:${claim.source_title}`;
    if (!sourceIds.has(sourceId)) {
      sourceIds.add(sourceId);
      const authors = claim.source_author.length > 0
        ? claim.source_author.join(', ')
        : 'Unknown';
      nodes.push({
        id: sourceId,
        type: 'source',
        label: `${claim.source_title} (${authors})`,
        phase: 'retrieval',
        sourceTitle: claim.source_title,
        depth_level: 0,
        evidence_strength: 1,
        novelty_score: 0,
        pass_origin: 'retrieval',
        conflict_status: 'none'
      });
    }
  }

  // Create claim nodes
  for (const [idx, claim] of retrieval.claims.entries()) {
    nodes.push({
      id: `claim:${claim.id}`,
      type: 'claim',
      label: claim.text.slice(0, 60) + (claim.text.length > 60 ? '...' : ''),
      phase: 'retrieval',
      domain: claim.domain,
      sourceTitle: claim.source_title,
      traversalDepth: claimDepth.get(claim.id),
      relevance: 1 - idx / Math.max(retrieval.claims.length, 1),
      isSeed: seedClaimIds.has(claim.id),
      isTraversed: !seedClaimIds.has(claim.id),
      confidenceBand: claim.confidence >= 0.85 ? 'high' : claim.confidence >= 0.65 ? 'medium' : 'low',
      depth_level: claimDepth.get(claim.id) ?? 0,
      evidence_strength: claim.confidence,
      novelty_score: seedClaimIds.has(claim.id) ? 0 : 0.2,
      pass_origin: 'retrieval',
      conflict_status: 'none'
    });
    if (!seedClaimIds.has(claim.id)) {
      traversedNodeIds.push(`claim:${claim.id}`);
    }

    // Edge from source to claim
    const sourceId = `source:${claim.source_title}`;
    edges.push({
      from: sourceId,
      to: `claim:${claim.id}`,
      type: 'contains',
      depth_level: 0,
      evidence_strength: 1,
      novelty_score: 0,
      pass_origin: 'retrieval',
      conflict_status: 'none'
    });
  }

  const ghostNodeIds = new Set<string>();
  const claimNodeIdSet = new Set(retrieval.claims.map((claim) => `claim:${claim.id}`));
  const sourceNodeIdSet = new Set(Array.from(sourceIds));

  for (const rejected of retrieval.trace?.rejected_claims ?? []) {
    const ghostId = `ghost:claim:${rejected.id}`;
    if (ghostNodeIds.has(ghostId)) continue;
    ghostNodeIds.add(ghostId);

    const anchorFromSeed = rejected.anchor_claim_id ? `claim:${rejected.anchor_claim_id}` : undefined;
    const sourceAnchor = rejected.source_title ? `source:${rejected.source_title}` : undefined;
    const anchorNodeId =
      (anchorFromSeed && claimNodeIdSet.has(anchorFromSeed) ? anchorFromSeed : undefined) ??
      (sourceAnchor && sourceNodeIdSet.has(sourceAnchor) ? sourceAnchor : undefined) ??
      (retrieval.seed_claim_ids[0] ? `claim:${retrieval.seed_claim_ids[0]}` : undefined);

    rejectedNodes.push({
      id: ghostId,
      label: rejected.text.slice(0, 64) + (rejected.text.length > 64 ? '...' : ''),
      reasonCode: rejected.reason_code,
      consideredIn: rejected.considered_in,
      sourceTitle: rejected.source_title,
      confidence: rejected.confidence,
      anchorNodeId,
      pass_origin: 'retrieval'
    });
  }

  // Create edges for claim relationships
  for (const relation of retrieval.relations) {
    const fromClaim = retrieval.claims[relation.from_index];
    const toClaim = retrieval.claims[relation.to_index];
    
    if (fromClaim && toClaim) {
      const edgeType = mapRelationType(relation.relation_type);
      edges.push({
        from: `claim:${fromClaim.id}`,
        to: `claim:${toClaim.id}`,
        type: edgeType,
        phaseOrigin: 'retrieval',
        depth_level: Math.max(claimDepth.get(fromClaim.id) ?? 0, claimDepth.get(toClaim.id) ?? 0),
        evidence_strength: relation.strength === 'strong' ? 0.85 : relation.strength === 'weak' ? 0.55 : 0.7,
        novelty_score: 0.25,
        pass_origin: 'retrieval',
        conflict_status: edgeType === 'contradicts' ? 'contested' : 'none',
        relation_rationale: relation.note,
        relation_confidence: relation.strength === 'strong' ? 0.85 : relation.strength === 'weak' ? 0.55 : 0.7,
        evidence_count: relation.note ? 1 : 0,
        evidence_sources: relation.note ? [`note:${relation.note.slice(0, 40)}`] : []
      });
    }
  }

  for (const [idx, rejected] of (retrieval.trace?.rejected_relations ?? []).entries()) {
    const fromClaimNode = `claim:${rejected.from_claim_id}`;
    const toClaimNode = `claim:${rejected.to_claim_id}`;
    const fromGhostNode = `ghost:claim:${rejected.from_claim_id}`;
    const toGhostNode = `ghost:claim:${rejected.to_claim_id}`;

    const from =
      (claimNodeIdSet.has(fromClaimNode) ? fromClaimNode : undefined) ??
      (ghostNodeIds.has(fromGhostNode) ? fromGhostNode : undefined);
    const to =
      (claimNodeIdSet.has(toClaimNode) ? toClaimNode : undefined) ??
      (ghostNodeIds.has(toGhostNode) ? toGhostNode : undefined);

    if (!from || !to) continue;

    rejectedEdges.push({
      id: `ghost:edge:${idx}:${rejected.from_claim_id}:${rejected.to_claim_id}:${rejected.relation_type}`,
      from,
      to,
      type: mapRelationType(rejected.relation_type),
      reasonCode: rejected.reason_code,
      relation_confidence: rejected.strength === 'strong' ? 0.85 : rejected.strength === 'weak' ? 0.55 : 0.65,
      rationale_source: rejected.note ? `note:${rejected.note.slice(0, 80)}` : undefined,
      pass_origin: 'retrieval'
    });
  }

  const relationTypeCounts: Partial<Record<GraphEdge['type'], number>> = {};
  for (const edge of edges) {
    relationTypeCounts[edge.type] = (relationTypeCounts[edge.type] ?? 0) + 1;
  }

  return {
    nodes,
    edges,
    meta: {
      seedNodeIds: retrieval.seed_claim_ids.map((id) => `claim:${id}`),
      traversedNodeIds,
      relationTypeCounts,
      maxHops: Math.max(...Array.from(claimDepth.values()), 0),
      contextSufficiency:
        retrieval.degraded || retrieval.claims.length < 3
          ? 'sparse'
          : retrieval.claims.length >= 8 && retrieval.relations.length >= 6
            ? 'strong'
            : 'moderate',
      retrievalDegraded: retrieval.degraded,
      retrievalDegradedReason: retrieval.degraded_reason,
      retrievalTimestamp: new Date().toISOString(),
      retrievalTrace: retrieval.trace
        ? {
            seedPoolCount: retrieval.trace.seed_pool_count,
            selectedSeedCount: retrieval.trace.selected_seed_count,
            hybridMode: retrieval.trace.hybrid_mode,
            denseSeedCount: retrieval.trace.dense_seed_count,
            lexicalSeedCount: retrieval.trace.lexical_seed_count,
            lexicalTerms: retrieval.trace.lexical_terms,
            corpusLevelQuery: retrieval.trace.corpus_level_query,
            seedBalanceStats: retrieval.trace.seed_balance_stats
              ? {
                  selectionStrategy: retrieval.trace.seed_balance_stats.selection_strategy,
                  mmrLambda: retrieval.trace.seed_balance_stats.mmr_lambda,
                  roleCountsPool: {
                    support: retrieval.trace.seed_balance_stats.role_counts_pool.support,
                    objection: retrieval.trace.seed_balance_stats.role_counts_pool.objection,
                    reply: retrieval.trace.seed_balance_stats.role_counts_pool.reply,
                    definitionDistinction:
                      retrieval.trace.seed_balance_stats.role_counts_pool.definition_distinction
                  },
                  roleCountsSelected: {
                    support: retrieval.trace.seed_balance_stats.role_counts_selected.support,
                    objection: retrieval.trace.seed_balance_stats.role_counts_selected.objection,
                    reply: retrieval.trace.seed_balance_stats.role_counts_selected.reply,
                    definitionDistinction:
                      retrieval.trace.seed_balance_stats.role_counts_selected.definition_distinction
                  },
                  roleQuotas: {
                    support: retrieval.trace.seed_balance_stats.role_quotas.support,
                    objection: retrieval.trace.seed_balance_stats.role_quotas.objection,
                    reply: retrieval.trace.seed_balance_stats.role_quotas.reply,
                    definitionDistinction:
                      retrieval.trace.seed_balance_stats.role_quotas.definition_distinction
                  },
                  quotaSatisfiedRoles: retrieval.trace.seed_balance_stats.quota_satisfied_roles,
                  avgPairwiseSimilarityBefore:
                    retrieval.trace.seed_balance_stats.avg_pairwise_similarity_before,
                  avgPairwiseSimilarityAfter:
                    retrieval.trace.seed_balance_stats.avg_pairwise_similarity_after,
                  objectionReplyPresenceBefore:
                    retrieval.trace.seed_balance_stats.objection_reply_presence_before,
                  objectionReplyPresenceAfter:
                    retrieval.trace.seed_balance_stats.objection_reply_presence_after,
                  monoPerspectiveBefore: retrieval.trace.seed_balance_stats.mono_perspective_before,
                  monoPerspectiveAfter: retrieval.trace.seed_balance_stats.mono_perspective_after
                }
              : undefined,
            traversedClaimCount: retrieval.trace.traversed_claim_count,
            relationCandidateCount: retrieval.trace.relation_candidate_count,
            relationKeptCount: retrieval.trace.relation_kept_count,
            argumentCandidateCount: retrieval.trace.argument_candidate_count,
            argumentKeptCount: retrieval.trace.argument_kept_count,
            rejectedClaimCount: retrieval.trace.rejected_claims?.length ?? 0,
            rejectedRelationCount: retrieval.trace.rejected_relations?.length ?? 0
          }
        : undefined,
      rejectedNodes,
      rejectedEdges
    }
  };
}

function mapRelationType(dbType: string): GraphEdge['type'] {
  const mapping: Record<string, GraphEdge['type']> = {
    'supports': 'supports',
    'contradicts': 'contradicts',
    'responds_to': 'responds-to',
    'depends_on': 'depends-on',
    'defines': 'defines',
    'qualifies': 'qualifies',
    'refines': 'qualifies',
    'exemplifies': 'supports',
    'assumes': 'assumes',
    'resolves': 'resolves'
  };
  return mapping[dbType] || 'supports';
}
