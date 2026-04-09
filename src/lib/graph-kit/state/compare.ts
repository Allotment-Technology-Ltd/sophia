import type { GraphKitCompareResult, GraphKitNodeKind } from '$lib/graph-kit/types';
import type { GraphSnapshotMeta } from '@restormel/contracts/api';
import type { ReasoningObjectSnapshot } from '@restormel/contracts/reasoning-object';
import { diffReasoningSnapshots } from '@restormel/graph-reasoning-extensions/compare';

interface GraphKitCompareInput {
  label: string;
  query?: string;
  queryRunId?: string;
  timestamp?: string;
  meta?: GraphSnapshotMeta | null;
  snapshot: ReasoningObjectSnapshot;
}

function toGraphKitKind(kind?: string): GraphKitNodeKind | undefined {
  if (!kind) return undefined;
  return kind as GraphKitNodeKind;
}

// Compare mode now consumes package-owned reasoning snapshots instead of Graph Kit view
// models, so the UI becomes a consumer of canonical reasoning-state diffs rather than the
// source of truth for diffing semantics.
export function buildWorkspaceCompareResult(
  baseline: GraphKitCompareInput,
  current: GraphKitCompareInput
): GraphKitCompareResult {
  const diff = diffReasoningSnapshots(baseline.snapshot, current.snapshot);

  return {
    baselineRun: {
      label: baseline.label,
      query: baseline.query,
      queryRunId: baseline.queryRunId ?? baseline.snapshot.version.queryRunId,
      timestamp: baseline.timestamp ?? baseline.snapshot.version.generatedAt
    },
    currentRun: {
      label: current.label,
      query: current.query,
      queryRunId: current.queryRunId ?? current.snapshot.version.queryRunId,
      timestamp: current.timestamp ?? current.snapshot.version.generatedAt
    },
    baselineGraph: {
      label: baseline.label,
      snapshotId: baseline.meta?.snapshot_id ?? baseline.snapshot.version.snapshotId,
      parentSnapshotId: baseline.meta?.parent_snapshot_id ?? baseline.snapshot.version.parentSnapshotId,
      passSequence: baseline.meta?.pass_sequence ?? baseline.snapshot.version.passSequence,
      nodeCount: baseline.snapshot.graph.nodes.length,
      edgeCount: baseline.snapshot.graph.edges.length
    },
    currentGraph: {
      label: current.label,
      snapshotId: current.meta?.snapshot_id ?? current.snapshot.version.snapshotId,
      parentSnapshotId: current.meta?.parent_snapshot_id ?? current.snapshot.version.parentSnapshotId,
      passSequence: current.meta?.pass_sequence ?? current.snapshot.version.passSequence,
      nodeCount: current.snapshot.graph.nodes.length,
      edgeCount: current.snapshot.graph.edges.length
    },
    addedNodes: diff.addedNodes.map((item) => ({
      signature: item.compareKey,
      nodeId: item.objectId ?? item.compareKey,
      title: item.title,
      kind: toGraphKitKind(item.kind) ?? 'claim'
    })),
    removedNodes: diff.removedNodes.map((item) => ({
      signature: item.compareKey,
      nodeId: item.objectId ?? item.compareKey,
      title: item.title,
      kind: toGraphKitKind(item.kind) ?? 'claim'
    })),
    addedClaims: diff.addedClaims.map((item) => ({
      signature: item.compareKey,
      nodeId: item.objectId,
      title: item.title,
      kind: toGraphKitKind(item.kind)
    })),
    removedClaims: diff.removedClaims.map((item) => ({
      signature: item.compareKey,
      nodeId: item.objectId,
      title: item.title,
      kind: toGraphKitKind(item.kind)
    })),
    addedEdges: diff.addedEdges.map((item) => ({
      signature: item.compareKey,
      edgeId: item.edgeId ?? item.compareKey,
      kind: item.kind,
      fromTitle: item.fromTitle,
      toTitle: item.toTitle
    })),
    removedEdges: diff.removedEdges.map((item) => ({
      signature: item.compareKey,
      edgeId: item.edgeId ?? item.compareKey,
      kind: item.kind,
      fromTitle: item.fromTitle,
      toTitle: item.toTitle
    })),
    changedConfidence: diff.changedConfidence.map((item) => ({
      signature: item.compareKey,
      target: item.target === 'output' ? 'node' : item.target,
      title: item.title,
      before: item.before,
      after: item.after
    })),
    supportStrengthChanges: diff.supportStrengthChanges.map((item) => ({
      signature: item.compareKey,
      title: item.title,
      before: item.before,
      after: item.after
    })),
    contradictionChanges: diff.contradictionChanges.map((item) => ({
      signature: item.compareKey,
      title: item.title,
      before: item.before,
      after: item.after,
      beforeContradictionEdges: item.beforeContradictionEdges,
      afterContradictionEdges: item.afterContradictionEdges
    })),
    claimComparisons: diff.claimDiffs.map((item) => ({
      signature: item.compareKey,
      title: item.title,
      kind: item.kind as GraphKitNodeKind,
      baselineNodeId: item.baselineNodeId,
      currentNodeId: item.currentNodeId,
      baselineConfidence: item.baselineConfidence,
      currentConfidence: item.currentConfidence,
      evidenceAdded: item.evidenceAdded,
      evidenceRemoved: item.evidenceRemoved,
      provenanceAdded: item.provenanceAdded,
      provenanceRemoved: item.provenanceRemoved,
      justificationPathAdded: item.justificationPathAdded,
      justificationPathRemoved: item.justificationPathRemoved,
      baselineSupportEdgeCount: item.baselineSupportEdgeCount,
      currentSupportEdgeCount: item.currentSupportEdgeCount,
      baselineContradictionEdgeCount: item.baselineContradictionEdgeCount,
      currentContradictionEdgeCount: item.currentContradictionEdgeCount
    })),
    evidenceSetComparisons: diff.evidenceSetDiffs.map((item) => ({
      ownerSignature: item.ownerCompareKey,
      ownerTitle: item.ownerTitle,
      addedEvidence: item.addedEvidence,
      removedEvidence: item.removedEvidence
    })),
    provenanceComparisons: diff.provenanceDiffs.map((item) => ({
      ownerSignature: item.ownerCompareKey,
      ownerTitle: item.ownerTitle,
      addedProvenance: item.addedProvenance,
      removedProvenance: item.removedProvenance
    })),
    justificationPathComparisons: diff.justificationPathDiffs.map((item) => ({
      ownerSignature: item.ownerCompareKey,
      ownerTitle: item.ownerTitle,
      addedPaths: item.addedPaths,
      removedPaths: item.removedPaths
    })),
    outputComparisons: diff.outputDiffs.map((item) => ({
      signature: item.compareKey,
      kind: item.kind,
      title: item.title,
      baselineOutputId: item.baselineOutputId,
      currentOutputId: item.currentOutputId,
      baselineConfidence: item.baselineConfidence,
      currentConfidence: item.currentConfidence,
      textChanged: item.textChanged,
      derivedNodeIdsAdded: item.derivedNodeIdsAdded,
      derivedNodeIdsRemoved: item.derivedNodeIdsRemoved
    })),
    summary: diff.summary,
    notes: diff.notes,
    todo: [
      'Real now: reasoning-object diffs for claims, evidence, provenance, support strength, contradiction state, outputs, and local justification paths.',
      'Partial now: baseline selection still relies on cached SOPHIA runs rather than an arbitrary dual-run picker.',
      'TODO compare-mode graph overlays',
      'TODO side-by-side inspector diff view',
      'TODO baseline graph frame replay'
    ]
  };
}
