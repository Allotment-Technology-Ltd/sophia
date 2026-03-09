import type { SSEEvent } from '$lib/types/api';
import { referencesStore } from '$lib/stores/references.svelte';
import { graphStore } from '$lib/stores/graph.svelte';
import { resolveBackRefs } from './backRef';

/**
 * Routes an SSE event to the appropriate store.
 * Phase 2 events (pass_start, pass_chunk, pass_complete, metadata, error)
 * are returned for the conversation store to handle.
 * Phase 3c events (claims, relations) are routed directly to referencesStore.
 *
 * Returns true if the event was handled here (Phase 3c), false if the caller
 * should handle it (Phase 2).
 */
export function handleSSEEvent(event: SSEEvent): boolean {
  switch (event.type) {
    case 'claims': {
      const resolved = resolveBackRefs(event.claims, referencesStore.activeClaims);
      referencesStore.addClaims(event.pass, resolved, []);
      graphStore.addFromClaims(event.pass, resolved, []);
      referencesStore.setPhase(event.pass);
      referencesStore.setLive(true);
      return true;
    }

    case 'relations': {
      // Relations are bundled — add them to existing claims
      for (const bundle of event.relations) {
        referencesStore.addClaims(event.pass, [], [bundle]);
      }
      graphStore.addFromClaims(event.pass, [], event.relations);
      return true;
    }

    case 'sources': {
      referencesStore.setSources(event.sources);
      return true;
    }

    case 'grounding_sources': {
      referencesStore.setGroundingSources(event.pass, event.sources);
      return true;
    }

    case 'graph_snapshot': {
      console.log('[SSE] Received graph_snapshot:', { nodeCount: event.nodes.length, edgeCount: event.edges.length });
      graphStore.setGraph(event.nodes, event.edges, event.meta, event.version);
      return true;
    }

    case 'pass_start':
      graphStore.setLoading();
      referencesStore.setPhase(event.pass as 'analysis' | 'critique' | 'synthesis');
      referencesStore.setLive(true);
      return false;

    case 'metadata':
      if (event.retrieval_degraded && graphStore.rawNodes.length === 0) {
        graphStore.setDegraded(event.retrieval_degraded_reason ?? 'retrieval_degraded');
      }
      referencesStore.setLive(false);
      referencesStore.setPhase(null);
      return false;

    default:
      return false;
  }
}
