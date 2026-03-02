import type { RetrievalResult } from './retrieval';
import type { GraphNode, GraphEdge } from '$lib/types/api';

/**
 * Project retrieval result into graph visualization format.
 * Creates nodes for sources and claims, edges for relationships.
 */
export function projectRetrievalToGraph(retrieval: RetrievalResult): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const sourceIds = new Set<string>();

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
        phase: 'retrieval'
      });
    }
  }

  // Create claim nodes
  for (const claim of retrieval.claims) {
    nodes.push({
      id: `claim:${claim.id}`,
      type: 'claim',
      label: claim.text.slice(0, 60) + (claim.text.length > 60 ? '...' : ''),
      phase: 'retrieval'
    });

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
        type: edgeType
      });
    }
  }

  return { nodes, edges };
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
