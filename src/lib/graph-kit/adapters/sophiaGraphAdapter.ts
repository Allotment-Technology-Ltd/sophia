import type {
  EnrichmentStatusEvent,
  GraphEdge,
  GraphGhostEdge,
  GraphGhostNode,
  GraphNode,
  GraphSnapshotMeta
} from '@restormel/contracts/api';
import type { AnalysisPhase, Claim, RelationBundle } from '@restormel/contracts/references';
import type { ReasoningObjectSnapshot } from '@restormel/contracts/reasoning-object';
import type { ReasoningEvaluation } from '@restormel/contracts/verification';
import type { GraphKitGhostEdge, GraphKitGhostNode, GraphKitWorkspaceData } from '$lib/graph-kit/types';
import { adaptReasoningSnapshotToGraphKit } from '$lib/graph-kit/adapters/reasoningObjectGraphAdapter';
import {
  adaptSophiaReasoningObjectBundle,
  getSophiaPlaybackMissingCapabilities,
  type SophiaReasoningObjectBundle,
  type SophiaReasoningObjectContext
} from '$lib/graph-kit/adapters/sophiaReasoningObjectAdapter';

const PHASE_DEPTH_LEVEL: Record<AnalysisPhase, number> = {
  analysis: 1,
  critique: 2,
  synthesis: 3
};

function adaptGhostNode(node: GraphGhostNode): GraphKitGhostNode {
  return {
    id: node.id,
    title: node.label,
    kind: 'candidate',
    reasonCode: node.reasonCode,
    phase: node.pass_origin,
    sourceTitle: node.sourceTitle,
    confidence: node.confidence,
    anchorNodeId: node.anchorNodeId
  };
}

function adaptGhostEdge(edge: GraphGhostEdge): GraphKitGhostEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.type,
    reasonCode: edge.reasonCode,
    phase: edge.pass_origin,
    confidence: edge.relation_confidence,
    rationale: edge.rationale_source
  };
}

function buildSummary(
  workspace: Pick<GraphKitWorkspaceData, 'graph'>,
  meta: GraphSnapshotMeta | null
): GraphKitWorkspaceData['summary'] {
  const warnings = [
    ...(meta?.retrievalDegraded
      ? [meta.retrievalDegradedReason ?? 'Retrieval degraded during this run.']
      : []),
    ...(workspace.graph.graphEvaluation?.summary.totalFindings
      ? [workspace.graph.graphEvaluation.summary.topLine]
      : []),
    ...(workspace.graph.missingData.length > 0 ? workspace.graph.missingData.slice(0, 2) : [])
  ];

  return {
    title: 'Restormel Graph Workspace',
    subtitle: 'Reasoning-object workspace derived from the current SOPHIA graph snapshot.',
    metrics: [
      { label: 'nodes', value: `${workspace.graph.nodes.length}` },
      { label: 'edges', value: `${workspace.graph.edges.length}` },
      { label: 'seed nodes', value: `${meta?.seedNodeIds?.length ?? 0}` },
      { label: 'context', value: meta?.contextSufficiency ?? 'unknown' },
      {
        label: 'graph eval',
        value: `${workspace.graph.graphEvaluation?.summary.totalFindings ?? 0} findings`
      }
    ],
    warnings
  };
}

export interface SophiaAdaptedGraphWorkspaceBundle {
  workspace: GraphKitWorkspaceData;
  snapshot: ReasoningObjectSnapshot;
  meta: GraphSnapshotMeta | null;
}

function buildWorkspaceFromReasoningBundle(
  bundle: SophiaReasoningObjectBundle
): SophiaAdaptedGraphWorkspaceBundle {
  const workspace = adaptReasoningSnapshotToGraphKit({
    snapshot: bundle.snapshot,
    ghostNodes: bundle.ghostNodes.map(adaptGhostNode),
    ghostEdges: bundle.ghostEdges.map(adaptGhostEdge),
    missingCapabilities: getSophiaPlaybackMissingCapabilities()
  });

  return {
    workspace: {
      summary: buildSummary(workspace, bundle.meta),
      graph: workspace.graph,
      traceEvents: workspace.traceEvents,
      playback: workspace.playback
    },
    snapshot: bundle.snapshot,
    meta: bundle.meta
  };
}

export function adaptSophiaGraphWorkspaceBundle(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: GraphSnapshotMeta | null;
  enrichmentStatus?: EnrichmentStatusEvent | null;
  traceContext?: SophiaReasoningObjectContext;
}): SophiaAdaptedGraphWorkspaceBundle {
  const bundle = adaptSophiaReasoningObjectBundle({
    nodes: params.nodes,
    edges: params.edges,
    meta: params.meta,
    enrichmentStatus: params.enrichmentStatus,
    traceContext: params.traceContext
  });

  return buildWorkspaceFromReasoningBundle(bundle);
}

export function adaptSophiaGraphWorkspace(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: GraphSnapshotMeta | null;
  enrichmentStatus?: EnrichmentStatusEvent | null;
  traceContext?: SophiaReasoningObjectContext;
}): GraphKitWorkspaceData {
  return adaptSophiaGraphWorkspaceBundle(params).workspace;
}

export function buildSophiaWorkspaceFromReferencesBundle(params: {
  claims: Claim[];
  relations: RelationBundle[];
}): SophiaAdaptedGraphWorkspaceBundle {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const claimPhase = new Map<string, AnalysisPhase>();

  for (const claim of params.claims) {
    claimPhase.set(claim.id, claim.phase);
    if (nodeIds.has(claim.id)) continue;
    nodes.push({
      id: claim.id,
      type: 'claim',
      label: claim.text,
      phase: claim.phase,
      pass_origin: claim.phase,
      depth_level: PHASE_DEPTH_LEVEL[claim.phase],
      evidence_strength: claim.confidence,
      derived_from: claim.backRefIds,
      conflict_status: claim.phase === 'critique' ? 'contested' : 'none'
    });
    nodeIds.add(claim.id);
  }

  for (const bundle of params.relations) {
    const phase = claimPhase.get(bundle.claimId) ?? 'analysis';
    for (const relation of bundle.relations) {
      const id = `${bundle.claimId}:${relation.type}:${relation.target}`;
      if (edgeIds.has(id)) continue;
      edges.push({
        from: bundle.claimId,
        to: relation.target,
        type: relation.type,
        phaseOrigin: phase,
        pass_origin: phase,
        depth_level: PHASE_DEPTH_LEVEL[phase],
        conflict_status:
          relation.type === 'contradicts'
            ? 'contested'
            : relation.type === 'resolves'
              ? 'resolved'
              : 'none'
      });
      edgeIds.add(id);
    }
  }

  return adaptSophiaGraphWorkspaceBundle({
    nodes,
    edges,
    meta: {
      contextSufficiency:
        nodes.length >= 8 ? 'strong' : nodes.length >= 3 ? 'moderate' : 'sparse',
      retrievalTimestamp: new Date().toISOString()
    },
    traceContext: {}
  });
}

export function buildSophiaWorkspaceFromReferences(params: {
  claims: Claim[];
  relations: RelationBundle[];
}): GraphKitWorkspaceData {
  return buildSophiaWorkspaceFromReferencesBundle(params).workspace;
}

export type { SophiaReasoningObjectContext };
export type SophiaTraceContext = SophiaReasoningObjectContext;
export type SophiaReasoningQuality = ReasoningEvaluation;
