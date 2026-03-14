import {
  adaptSophiaGraphWorkspaceBundle,
  buildSophiaWorkspaceFromReferencesBundle
} from '$lib/graph-kit/adapters/sophiaGraphAdapter';
import type { GraphKitWorkspaceData } from '$lib/graph-kit/types';
import type { CachedQueryResult } from '$lib/stores/history.svelte';
import type { Message } from '$lib/stores/conversation.svelte';
import type { EnrichmentStatusEvent, GraphEdge, GraphNode, GraphSnapshotMeta } from '@restormel/contracts/api';
import type { Claim, RelationBundle } from '@restormel/contracts/references';
import type { ReasoningObjectSnapshot } from '@restormel/contracts/reasoning-object';
import type { ReasoningEvent, RunTrace } from '@restormel/contracts/trace';
import type { NormalizedRunTrace } from '@restormel/contracts/trace-ingestion';

export interface SophiaWorkspaceBuildResult {
  workspace: GraphKitWorkspaceData;
  snapshot: ReasoningObjectSnapshot;
  meta: GraphSnapshotMeta | null;
}

export function buildSophiaWorkspaceBundleFromCurrentSession(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: GraphSnapshotMeta | null;
  enrichmentStatus?: EnrichmentStatusEvent | null;
  activeClaims: Claim[];
  relations: RelationBundle[];
  latestUserMessage?: Message | null;
  latestAssistantMessage?: Message | null;
  reasoningEvents?: ReasoningEvent[] | null;
  runTrace?: RunTrace | null;
  normalizedTrace?: NormalizedRunTrace | null;
}): SophiaWorkspaceBuildResult {
  const traceContext = {
    queryText: params.latestUserMessage?.content ?? null,
    finalOutputText: params.latestAssistantMessage?.content ?? null,
    reasoningQuality: params.latestAssistantMessage?.reasoningQuality ?? null,
    constitutionDeltas: params.latestAssistantMessage?.constitutionDeltas ?? null,
    reasoningEvents: params.reasoningEvents ?? null,
    runTrace: params.runTrace ?? null,
    normalizedTrace: params.normalizedTrace ?? null
  };

  if (params.nodes.length > 0 || params.edges.length > 0) {
    return adaptSophiaGraphWorkspaceBundle({
      nodes: params.nodes,
      edges: params.edges,
      meta: params.meta,
      enrichmentStatus: params.enrichmentStatus,
      traceContext
    });
  }

  if (params.activeClaims.length > 0) {
    return buildSophiaWorkspaceFromReferencesBundle({
      claims: params.activeClaims,
      relations: params.relations
    });
  }

  return adaptSophiaGraphWorkspaceBundle({
    nodes: [],
    edges: [],
    meta: params.meta,
    enrichmentStatus: params.enrichmentStatus,
    traceContext
  });
}

export function buildSophiaWorkspaceFromCurrentSession(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: GraphSnapshotMeta | null;
  enrichmentStatus?: EnrichmentStatusEvent | null;
  activeClaims: Claim[];
  relations: RelationBundle[];
  latestUserMessage?: Message | null;
  latestAssistantMessage?: Message | null;
  reasoningEvents?: ReasoningEvent[] | null;
  runTrace?: RunTrace | null;
  normalizedTrace?: NormalizedRunTrace | null;
}): GraphKitWorkspaceData {
  return buildSophiaWorkspaceBundleFromCurrentSession(params).workspace;
}

export function buildSophiaWorkspaceBundleFromCachedResult(
  cached: CachedQueryResult
): SophiaWorkspaceBuildResult {
  if (cached.graphSnapshot?.nodes && cached.graphSnapshot?.edges) {
    return adaptSophiaGraphWorkspaceBundle({
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
    return buildSophiaWorkspaceFromReferencesBundle({
      claims,
      relations
    });
  }

  return adaptSophiaGraphWorkspaceBundle({
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

export function buildSophiaWorkspaceFromCachedResult(cached: CachedQueryResult): GraphKitWorkspaceData {
  return buildSophiaWorkspaceBundleFromCachedResult(cached).workspace;
}
