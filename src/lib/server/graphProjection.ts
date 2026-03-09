import type { RetrievalResult } from './retrieval';
import type { GraphNode, GraphEdge, GraphSnapshotMeta } from '$lib/types/api';

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
        sourceTitle: claim.source_title
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
      confidenceBand: claim.confidence >= 0.85 ? 'high' : claim.confidence >= 0.65 ? 'medium' : 'low'
    });
    if (!seedClaimIds.has(claim.id)) {
      traversedNodeIds.push(`claim:${claim.id}`);
    }

    // Edge from source to claim
    const sourceId = `source:${claim.source_title}`;
    edges.push({
      from: sourceId,
      to: `claim:${claim.id}`,
      type: 'contains'
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
        phaseOrigin: 'retrieval'
      });
    }
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
      retrievalTimestamp: new Date().toISOString()
    }
  };
}

function mapRelationType(dbType: string): GraphEdge['type'] {
  const mapping: Record<string, GraphEdge['type']> = {
    'supports': 'supports',
    'contradicts': 'contradicts',
    'responds_to': 'responds-to',
    'depends_on': 'depends-on',
    'refines': 'supports',
    'exemplifies': 'supports'
  };
  return mapping[dbType] || 'supports';
}
