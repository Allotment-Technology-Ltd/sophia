import { create, query } from '$lib/server/db';
import type { GraphEdge, GraphNode } from '$lib/types/api';
import type { EnrichmentCandidateEdge, EnrichmentCandidateNode, StagingEnrichmentRecord } from '$lib/types/enrichment';

export interface SnapshotLineageRecord {
  snapshot_id: string;
  query_run_id: string;
  parent_snapshot_id?: string;
  pass_sequence: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  created_at: string;
}

export async function stageEnrichment(record: Omit<StagingEnrichmentRecord, 'id'>): Promise<string | null> {
  try {
    const result = await create<{ id?: string }>('staging_enrichment', record as Record<string, unknown>);
    return result?.id ?? null;
  } catch (err) {
    console.warn('[ENRICHMENT] Failed staging write:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function promoteEnrichment(
  queryRunId: string,
  nodes: EnrichmentCandidateNode[],
  edges: EnrichmentCandidateEdge[]
): Promise<number> {
  let promoted = 0;
  for (const node of nodes) {
    try {
      await create('graph_enrichment_canonical', {
        query_run_id: queryRunId,
        kind: 'node',
        payload: node,
        created_at: new Date().toISOString()
      });
      promoted += 1;
    } catch {
      // best-effort
    }
  }
  for (const edge of edges) {
    try {
      await create('graph_enrichment_canonical', {
        query_run_id: queryRunId,
        kind: 'edge',
        payload: edge,
        created_at: new Date().toISOString()
      });
      promoted += 1;
    } catch {
      // best-effort
    }
  }
  return promoted;
}

export async function recordSnapshotLineage(record: SnapshotLineageRecord): Promise<void> {
  try {
    await create('graph_snapshot_lineage', record as Record<string, unknown>);
  } catch (err) {
    console.warn('[ENRICHMENT] Failed snapshot lineage write:', err instanceof Error ? err.message : String(err));
  }
}

export async function loadSnapshotLineage(queryRunId: string): Promise<SnapshotLineageRecord[]> {
  try {
    return await query<SnapshotLineageRecord[]>(
      'SELECT snapshot_id, query_run_id, parent_snapshot_id, pass_sequence, nodes, edges, created_at FROM graph_snapshot_lineage WHERE query_run_id = $query_run_id ORDER BY pass_sequence ASC',
      { query_run_id: queryRunId }
    );
  } catch {
    return [];
  }
}
