import { adaptSophiaGraphWorkspace, buildSophiaWorkspaceFromReferences } from '$lib/graph-kit/adapters/sophiaGraphAdapter';
import type { GraphKitWorkspaceData } from '$lib/graph-kit/types';
import type { CachedQueryResult } from '$lib/stores/history.svelte';
import type { Message } from '$lib/stores/conversation.svelte';
import type { EnrichmentStatusEvent, GraphEdge, GraphNode, GraphSnapshotMeta } from '$lib/types/api';
import type { Claim, RelationBundle } from '$lib/types/references';

export function buildSophiaWorkspaceFromCurrentSession(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: GraphSnapshotMeta | null;
  enrichmentStatus?: EnrichmentStatusEvent | null;
  activeClaims: Claim[];
  relations: RelationBundle[];
  latestUserMessage?: Message | null;
  latestAssistantMessage?: Message | null;
}): GraphKitWorkspaceData {
  const traceContext = {
    queryText: params.latestUserMessage?.content ?? null,
    finalOutputText: params.latestAssistantMessage?.content ?? null,
    reasoningQuality: params.latestAssistantMessage?.reasoningQuality ?? null,
    constitutionDeltas: params.latestAssistantMessage?.constitutionDeltas ?? null
  };

  if (params.nodes.length > 0 || params.edges.length > 0) {
    return adaptSophiaGraphWorkspace({
      nodes: params.nodes,
      edges: params.edges,
      meta: params.meta,
      enrichmentStatus: params.enrichmentStatus,
      traceContext
    });
  }

  if (params.activeClaims.length > 0) {
    return buildSophiaWorkspaceFromReferences({
      claims: params.activeClaims,
      relations: params.relations
    });
  }

  return adaptSophiaGraphWorkspace({
    nodes: [],
    edges: [],
    meta: params.meta,
    enrichmentStatus: params.enrichmentStatus,
    traceContext
  });
}

export function buildSophiaWorkspaceFromCachedResult(cached: CachedQueryResult): GraphKitWorkspaceData {
  if (cached.graphSnapshot?.nodes && cached.graphSnapshot?.edges) {
    return adaptSophiaGraphWorkspace({
      nodes: cached.graphSnapshot.nodes,
      edges: cached.graphSnapshot.edges,
      meta: cached.graphSnapshot.meta,
      traceContext: {
        queryText: cached.query,
        finalOutputText:
          cached.passes.synthesis || cached.passes.critique || cached.passes.analysis,
        reasoningQuality: cached.reasoningQuality ?? null,
        constitutionDeltas: cached.constitutionDeltas ?? null
      }
    });
  }

  const claims = cached.claimsByPass.flatMap((entry) => entry.claims);
  const relations = cached.relationsByPass.flatMap((entry) => entry.relations);

  if (claims.length > 0) {
    return buildSophiaWorkspaceFromReferences({
      claims,
      relations
    });
  }

  return adaptSophiaGraphWorkspace({
    nodes: [],
    edges: [],
    traceContext: {
      queryText: cached.query,
      finalOutputText:
        cached.passes.synthesis || cached.passes.critique || cached.passes.analysis,
      reasoningQuality: cached.reasoningQuality ?? null,
      constitutionDeltas: cached.constitutionDeltas ?? null
    }
  });
}
