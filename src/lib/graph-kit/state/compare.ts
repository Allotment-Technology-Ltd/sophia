import type {
  GraphKitCompareResult,
  GraphKitEdge,
  GraphKitEntityStatus,
  GraphKitNode,
  GraphKitWorkspaceData
} from '$lib/graph-kit/types';
import type { GraphSnapshotMeta } from '$lib/types/api';

interface GraphKitCompareInput {
  label: string;
  query?: string;
  queryRunId?: string;
  timestamp?: string;
  meta?: GraphSnapshotMeta | null;
  workspace: GraphKitWorkspaceData;
}

interface NodeEntry {
  signature: string;
  node: GraphKitNode;
  evidenceSet: Set<string>;
}

interface EdgeEntry {
  signature: string;
  edge: GraphKitEdge;
  fromTitle: string;
  toTitle: string;
}

type ConfidenceChange = GraphKitCompareResult['changedConfidence'][number];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value: string, max = 120): string {
  return value.trim().length > max ? value.trim().slice(0, max) : value.trim();
}

function nodeSignature(node: GraphKitNode): string {
  return `${node.kind}|${normalize(clip(node.title))}`;
}

function evidenceSignature(value: string): string {
  return normalize(clip(value));
}

function buildNodeEntries(workspace: GraphKitWorkspaceData): Map<string, NodeEntry> {
  const entries = new Map<string, NodeEntry>();

  for (const node of workspace.graph.nodes) {
    const signature = nodeSignature(node);
    if (entries.has(signature)) continue;
    entries.set(signature, {
      signature,
      node,
      evidenceSet: new Set(
        node.evidence
          .map((item) => evidenceSignature(item.summary))
          .filter((value) => value.length > 0)
      )
    });
  }

  return entries;
}

function buildEdgeEntries(workspace: GraphKitWorkspaceData): Map<string, EdgeEntry> {
  const entries = new Map<string, EdgeEntry>();
  const nodeById = new Map(workspace.graph.nodes.map((node) => [node.id, node]));

  for (const edge of workspace.graph.edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;

    const fromTitle = fromNode.title;
    const toTitle = toNode.title;
    const signature = `${edge.kind}|${normalize(clip(fromTitle))}|${normalize(clip(toTitle))}`;
    if (entries.has(signature)) continue;

    entries.set(signature, {
      signature,
      edge,
      fromTitle,
      toTitle
    });
  }

  return entries;
}

function diffSets(before: Set<string>, after: Set<string>): { added: string[]; removed: string[] } {
  const added = [...after].filter((value) => !before.has(value));
  const removed = [...before].filter((value) => !after.has(value));
  return { added, removed };
}

// Extraction seam:
// This compares stable Graph Kit view models rather than raw SOPHIA graph data so the
// logic can move into a standalone package later with minimal changes.
export function buildWorkspaceCompareResult(
  baseline: GraphKitCompareInput,
  current: GraphKitCompareInput
): GraphKitCompareResult {
  const baselineNodes = buildNodeEntries(baseline.workspace);
  const currentNodes = buildNodeEntries(current.workspace);
  const baselineEdges = buildEdgeEntries(baseline.workspace);
  const currentEdges = buildEdgeEntries(current.workspace);

  const addedNodes = [...currentNodes.entries()]
    .filter(([signature]) => !baselineNodes.has(signature))
    .map(([, entry]) => ({
      signature: entry.signature,
      nodeId: entry.node.id,
      title: entry.node.title,
      kind: entry.node.kind
    }));

  const removedNodes = [...baselineNodes.entries()]
    .filter(([signature]) => !currentNodes.has(signature))
    .map(([, entry]) => ({
      signature: entry.signature,
      nodeId: entry.node.id,
      title: entry.node.title,
      kind: entry.node.kind
    }));

  const addedEdges = [...currentEdges.entries()]
    .filter(([signature]) => !baselineEdges.has(signature))
    .map(([, entry]) => ({
      signature: entry.signature,
      edgeId: entry.edge.id,
      kind: entry.edge.kind,
      fromTitle: entry.fromTitle,
      toTitle: entry.toTitle
    }));

  const removedEdges = [...baselineEdges.entries()]
    .filter(([signature]) => !currentEdges.has(signature))
    .map(([, entry]) => ({
      signature: entry.signature,
      edgeId: entry.edge.id,
      kind: entry.edge.kind,
      fromTitle: entry.fromTitle,
      toTitle: entry.toTitle
    }));

  const nodeConfidenceChanges: ConfidenceChange[] = [...currentNodes.entries()]
    .flatMap<ConfidenceChange>(([signature, currentEntry]) => {
      const baselineEntry = baselineNodes.get(signature);
      if (!baselineEntry) return [];
      if (baselineEntry.node.confidence === currentEntry.node.confidence) return [];
      if (
        typeof baselineEntry.node.confidence !== 'number' &&
        typeof currentEntry.node.confidence !== 'number'
      ) {
        return [];
      }
      return [{
        signature,
        target: 'node' as const,
        title: currentEntry.node.title,
        before: baselineEntry.node.confidence,
        after: currentEntry.node.confidence
      }];
    });

  const edgeConfidenceChanges: ConfidenceChange[] = [...currentEdges.entries()]
    .flatMap<ConfidenceChange>(([signature, currentEntry]) => {
      const baselineEntry = baselineEdges.get(signature);
      if (!baselineEntry) return [];
      if (baselineEntry.edge.confidence === currentEntry.edge.confidence) return [];
      if (
        typeof baselineEntry.edge.confidence !== 'number' &&
        typeof currentEntry.edge.confidence !== 'number'
      ) {
        return [];
      }
      return [{
        signature,
        target: 'edge',
        title: `${currentEntry.fromTitle} ${currentEntry.edge.kind} ${currentEntry.toTitle}`,
        before: baselineEntry.edge.confidence,
        after: currentEntry.edge.confidence
      }];
    });

  const changedConfidence = [...nodeConfidenceChanges, ...edgeConfidenceChanges];

  const contradictionChanges: GraphKitCompareResult['contradictionChanges'] = [...new Set([
    ...baselineNodes.keys(),
    ...currentNodes.keys()
  ])]
    .flatMap((signature) => {
      const before: GraphKitEntityStatus | 'missing' =
        baselineNodes.get(signature)?.node.status ?? 'missing';
      const after: GraphKitEntityStatus | 'missing' =
        currentNodes.get(signature)?.node.status ?? 'missing';
      if (before === after) return [];
      const beforeContradiction = before === 'contradicted' || before === 'unresolved';
      const afterContradiction = after === 'contradicted' || after === 'unresolved';
      if (!beforeContradiction && !afterContradiction) return [];
      const title =
        currentNodes.get(signature)?.node.title ??
        baselineNodes.get(signature)?.node.title ??
        signature;
      return [{ signature, title, before, after }];
    });

  const claimComparisons = [...currentNodes.entries()]
    .flatMap(([signature, currentEntry]) => {
      const baselineEntry = baselineNodes.get(signature);
      if (!baselineEntry) return [];
      if (
        !['claim', 'synthesis', 'conclusion', 'contradiction'].includes(currentEntry.node.kind) &&
        !['claim', 'synthesis', 'conclusion', 'contradiction'].includes(baselineEntry.node.kind)
      ) {
        return [];
      }

      const evidenceDiff = diffSets(baselineEntry.evidenceSet, currentEntry.evidenceSet);
      const confidenceChanged = baselineEntry.node.confidence !== currentEntry.node.confidence;
      if (!confidenceChanged && evidenceDiff.added.length === 0 && evidenceDiff.removed.length === 0) {
        return [];
      }

      return [{
        signature,
        title: currentEntry.node.title,
        baselineNodeId: baselineEntry.node.id,
        currentNodeId: currentEntry.node.id,
        baselineConfidence: baselineEntry.node.confidence,
        currentConfidence: currentEntry.node.confidence,
        evidenceAdded: evidenceDiff.added,
        evidenceRemoved: evidenceDiff.removed
      }];
    });

  const evidenceSetComparisons = claimComparisons
    .filter((comparison) => comparison.evidenceAdded.length > 0 || comparison.evidenceRemoved.length > 0)
    .map((comparison) => ({
      ownerSignature: comparison.signature,
      ownerTitle: comparison.title,
      addedEvidence: comparison.evidenceAdded,
      removedEvidence: comparison.evidenceRemoved
    }));

  const summaryBits = [
    `${addedNodes.length} added nodes`,
    `${removedNodes.length} removed nodes`,
    `${addedEdges.length} added edges`,
    `${removedEdges.length} removed edges`
  ];
  if (changedConfidence.length > 0) summaryBits.push(`${changedConfidence.length} confidence changes`);
  if (contradictionChanges.length > 0) summaryBits.push(`${contradictionChanges.length} contradiction changes`);

  return {
    baselineRun: {
      label: baseline.label,
      query: baseline.query,
      queryRunId: baseline.queryRunId,
      timestamp: baseline.timestamp
    },
    currentRun: {
      label: current.label,
      query: current.query,
      queryRunId: current.queryRunId,
      timestamp: current.timestamp
    },
    baselineGraph: {
      label: baseline.label,
      snapshotId: baseline.meta?.snapshot_id,
      parentSnapshotId: baseline.meta?.parent_snapshot_id,
      passSequence: baseline.meta?.pass_sequence,
      nodeCount: baseline.workspace.graph.nodes.length,
      edgeCount: baseline.workspace.graph.edges.length
    },
    currentGraph: {
      label: current.label,
      snapshotId: current.meta?.snapshot_id,
      parentSnapshotId: current.meta?.parent_snapshot_id,
      passSequence: current.meta?.pass_sequence,
      nodeCount: current.workspace.graph.nodes.length,
      edgeCount: current.workspace.graph.edges.length
    },
    addedNodes,
    removedNodes,
    addedEdges,
    removedEdges,
    changedConfidence,
    contradictionChanges,
    claimComparisons,
    evidenceSetComparisons,
    summary: summaryBits.join(' · '),
    todo: [
      'TODO compare-mode graph overlays',
      'TODO aligned inspector diff view',
      'TODO run-to-run playback diff'
    ]
  };
}
