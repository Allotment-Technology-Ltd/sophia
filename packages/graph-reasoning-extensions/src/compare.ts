import type {
  ReasoningObjectClaimDiff,
  ReasoningObjectCompareEntityRef,
  ReasoningObjectCompareEdgeRef,
  ReasoningObjectCompareValueChange,
  ReasoningObjectEvidenceSetDiff,
  ReasoningObjectJustificationPathDiff,
  ReasoningObjectOutputDiff,
  ReasoningObjectProvenanceDiff,
  ReasoningObjectSnapshot,
  ReasoningObjectSnapshotDiff,
  ReasoningObjectStatus
} from '@restormel/contracts';

interface NodeEntry {
  node: ReasoningObjectSnapshot['graph']['nodes'][number];
  evidenceSet: Set<string>;
  provenanceSet: Set<string>;
  justificationSet: Set<string>;
  supportEdgeCount: number;
  contradictionEdgeCount: number;
}

interface EdgeEntry {
  edge: ReasoningObjectSnapshot['graph']['edges'][number];
  fromTitle: string;
  toTitle: string;
}

interface OutputEntry {
  output: ReasoningObjectSnapshot['outputs'][number];
  compareKey: string;
}

const CLAIM_KINDS = new Set(['claim', 'synthesis', 'conclusion', 'contradiction']);
const SUPPORT_EDGE_KINDS = new Set([
  'supports',
  'derived-from',
  'inferred-by',
  'depends-on',
  'responds-to',
  'resolves',
  'defines',
  'qualifies',
  'cites',
  'retrieved-from',
  'assumes'
]);
const JUSTIFICATION_EDGE_KINDS = new Set([
  ...SUPPORT_EDGE_KINDS,
  'contradicts',
  'unresolved'
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value: string, max = 120): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function diffSets(before: Set<string>, after: Set<string>): { added: string[]; removed: string[] } {
  return {
    added: [...after].filter((value) => !before.has(value)),
    removed: [...before].filter((value) => !after.has(value))
  };
}

function evidenceSignature(
  evidence: ReasoningObjectSnapshot['graph']['nodes'][number]['evidence'][number]
): string {
  return normalize(
    [
      evidence.kind,
      clip(evidence.summary),
      evidence.sourceTitle ?? '',
      evidence.relatedObjectId ?? '',
      evidence.provenanceId ?? ''
    ].join('|')
  );
}

function provenanceSignature(
  provenance: ReasoningObjectSnapshot['graph']['nodes'][number]['provenance'][number]
): string {
  const sourceRefs = provenance.sourceRefs
    .map((ref) => `${ref.kind}:${clip(ref.value, 80)}`)
    .sort()
    .join(',');

  return normalize(
    [
      provenance.kind,
      clip(provenance.value),
      provenance.pass ?? '',
      provenance.queryRunId ?? '',
      sourceRefs
    ].join('|')
  );
}

function outputCompareKey(output: ReasoningObjectSnapshot['outputs'][number]): string {
  return `${output.kind}|${normalize(clip(output.title))}`;
}

function buildNodeEntries(snapshot: ReasoningObjectSnapshot): Map<string, NodeEntry> {
  const nodeById = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
  const entries = new Map<string, NodeEntry>();

  for (const node of snapshot.graph.nodes) {
    const compareKey = node.metadata.compareKey;
    if (entries.has(compareKey)) continue;

    const supportPaths = new Set<string>();
    let supportEdgeCount = 0;
    let contradictionEdgeCount = 0;

    for (const edge of snapshot.graph.edges) {
      if (edge.from !== node.id && edge.to !== node.id) continue;
      if (!JUSTIFICATION_EDGE_KINDS.has(edge.kind)) continue;

      const isIncoming = edge.to === node.id;
      const otherNodeId = isIncoming ? edge.from : edge.to;
      const otherNode = nodeById.get(otherNodeId);
      const otherKey = otherNode?.metadata.compareKey ?? otherNodeId;
      supportPaths.add(`${isIncoming ? 'in' : 'out'}|${edge.kind}|${otherKey}`);

      if (SUPPORT_EDGE_KINDS.has(edge.kind)) supportEdgeCount += 1;
      if (edge.kind === 'contradicts' || edge.kind === 'unresolved') contradictionEdgeCount += 1;
    }

    entries.set(compareKey, {
      node,
      evidenceSet: new Set(node.evidence.map(evidenceSignature).filter(Boolean)),
      provenanceSet: new Set(node.provenance.map(provenanceSignature).filter(Boolean)),
      justificationSet: supportPaths,
      supportEdgeCount,
      contradictionEdgeCount
    });
  }

  return entries;
}

function buildEdgeEntries(snapshot: ReasoningObjectSnapshot): Map<string, EdgeEntry> {
  const nodeById = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
  const entries = new Map<string, EdgeEntry>();

  for (const edge of snapshot.graph.edges) {
    const compareKey = edge.metadata.compareKey;
    if (entries.has(compareKey)) continue;

    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);

    entries.set(compareKey, {
      edge,
      fromTitle: fromNode?.title ?? edge.from,
      toTitle: toNode?.title ?? edge.to
    });
  }

  return entries;
}

function buildOutputEntries(snapshot: ReasoningObjectSnapshot): Map<string, OutputEntry> {
  const entries = new Map<string, OutputEntry>();

  for (const output of snapshot.outputs) {
    const compareKey = outputCompareKey(output);
    if (entries.has(compareKey)) continue;
    entries.set(compareKey, { output, compareKey });
  }

  return entries;
}

function toEntityRef(
  compareKey: string,
  node: ReasoningObjectSnapshot['graph']['nodes'][number]
): ReasoningObjectCompareEntityRef {
  return {
    compareKey,
    objectId: node.id,
    title: node.title,
    kind: node.kind
  };
}

function toEdgeRef(compareKey: string, entry: EdgeEntry): ReasoningObjectCompareEdgeRef {
  return {
    compareKey,
    edgeId: entry.edge.id,
    kind: entry.edge.kind,
    fromTitle: entry.fromTitle,
    toTitle: entry.toTitle
  };
}

function collectConfidenceChanges(
  baselineNodes: Map<string, NodeEntry>,
  currentNodes: Map<string, NodeEntry>,
  baselineEdges: Map<string, EdgeEntry>,
  currentEdges: Map<string, EdgeEntry>
): ReasoningObjectCompareValueChange[] {
  const nodeChanges = [...currentNodes.entries()].flatMap<ReasoningObjectCompareValueChange>(
    ([compareKey, currentEntry]) => {
      const baselineEntry = baselineNodes.get(compareKey);
      if (!baselineEntry) return [];
      if (baselineEntry.node.confidence === currentEntry.node.confidence) return [];
      if (
        typeof baselineEntry.node.confidence !== 'number' &&
        typeof currentEntry.node.confidence !== 'number'
      ) {
        return [];
      }

      return [{
        compareKey,
        target: 'node',
        title: currentEntry.node.title,
        before: baselineEntry.node.confidence,
        after: currentEntry.node.confidence
      }];
    }
  );

  const edgeChanges = [...currentEdges.entries()].flatMap<ReasoningObjectCompareValueChange>(
    ([compareKey, currentEntry]) => {
      const baselineEntry = baselineEdges.get(compareKey);
      if (!baselineEntry) return [];
      if (baselineEntry.edge.confidence === currentEntry.edge.confidence) return [];
      if (
        typeof baselineEntry.edge.confidence !== 'number' &&
        typeof currentEntry.edge.confidence !== 'number'
      ) {
        return [];
      }

      return [{
        compareKey,
        target: 'edge',
        title: `${currentEntry.fromTitle} ${currentEntry.edge.kind} ${currentEntry.toTitle}`,
        before: baselineEntry.edge.confidence,
        after: currentEntry.edge.confidence
      }];
    }
  );

  return [...nodeChanges, ...edgeChanges];
}

function collectSupportStrengthChanges(
  baselineEdges: Map<string, EdgeEntry>,
  currentEdges: Map<string, EdgeEntry>,
  changedConfidence: ReasoningObjectCompareValueChange[]
): ReasoningObjectCompareValueChange[] {
  const matchedChanges = changedConfidence.filter(({ target, compareKey }) => {
    if (target !== 'edge') return false;
    const edgeKind = currentEdges.get(compareKey)?.edge.kind ?? baselineEdges.get(compareKey)?.edge.kind;
    return !!edgeKind && SUPPORT_EDGE_KINDS.has(edgeKind);
  });

  const addedSupportEdges = [...currentEdges.entries()].flatMap<ReasoningObjectCompareValueChange>(
    ([compareKey, entry]) => {
      if (baselineEdges.has(compareKey) || !SUPPORT_EDGE_KINDS.has(entry.edge.kind)) return [];
      return [{
        compareKey,
        target: 'edge',
        title: `${entry.fromTitle} ${entry.edge.kind} ${entry.toTitle}`,
        before: undefined,
        after: entry.edge.confidence
      }];
    }
  );

  const removedSupportEdges = [...baselineEdges.entries()].flatMap<ReasoningObjectCompareValueChange>(
    ([compareKey, entry]) => {
      if (currentEdges.has(compareKey) || !SUPPORT_EDGE_KINDS.has(entry.edge.kind)) return [];
      return [{
        compareKey,
        target: 'edge',
        title: `${entry.fromTitle} ${entry.edge.kind} ${entry.toTitle}`,
        before: entry.edge.confidence,
        after: undefined
      }];
    }
  );

  return [...matchedChanges, ...addedSupportEdges, ...removedSupportEdges];
}

function collectOutputDiffs(
  baselineOutputs: Map<string, OutputEntry>,
  currentOutputs: Map<string, OutputEntry>
): ReasoningObjectOutputDiff[] {
  return [...new Set([...baselineOutputs.keys(), ...currentOutputs.keys()])].flatMap<ReasoningObjectOutputDiff>((compareKey) => {
    const baselineEntry = baselineOutputs.get(compareKey);
    const currentEntry = currentOutputs.get(compareKey);
    if (!baselineEntry && !currentEntry) return [];

    const baselineOutput = baselineEntry?.output;
    const currentOutput = currentEntry?.output;
    if (!baselineOutput || !currentOutput) {
      const existing = currentOutput ?? baselineOutput;
      if (!existing) return [];
      return [{
        compareKey,
        kind: existing.kind,
        title: existing.title,
        baselineOutputId: baselineOutput?.id,
        currentOutputId: currentOutput?.id,
        baselineConfidence: baselineOutput?.confidence,
        currentConfidence: currentOutput?.confidence,
        textChanged: true,
        derivedNodeIdsAdded: currentOutput?.derivedNodeIds ?? [],
        derivedNodeIdsRemoved: baselineOutput?.derivedNodeIds ?? []
      }];
    }

    const derivedDiff = diffSets(
      new Set(baselineOutput.derivedNodeIds),
      new Set(currentOutput.derivedNodeIds)
    );
    const textChanged = baselineOutput.text !== currentOutput.text;
    const confidenceChanged = baselineOutput.confidence !== currentOutput.confidence;
    if (!textChanged && !confidenceChanged && derivedDiff.added.length === 0 && derivedDiff.removed.length === 0) {
      return [];
    }

    return [{
      compareKey,
      kind: currentOutput.kind,
      title: currentOutput.title,
      baselineOutputId: baselineOutput.id,
      currentOutputId: currentOutput.id,
      baselineConfidence: baselineOutput.confidence,
      currentConfidence: currentOutput.confidence,
      textChanged,
      derivedNodeIdsAdded: derivedDiff.added,
      derivedNodeIdsRemoved: derivedDiff.removed
    }];
  });
}

function isClaimLikeKind(kind: string): boolean {
  return CLAIM_KINDS.has(kind);
}

function isContradictionLikeStatus(status: ReasoningObjectStatus | 'missing'): boolean {
  return status === 'contradicted' || status === 'unresolved';
}

export function diffReasoningSnapshots(
  baseline: ReasoningObjectSnapshot,
  current: ReasoningObjectSnapshot
): ReasoningObjectSnapshotDiff {
  const baselineNodes = buildNodeEntries(baseline);
  const currentNodes = buildNodeEntries(current);
  const baselineEdges = buildEdgeEntries(baseline);
  const currentEdges = buildEdgeEntries(current);
  const baselineOutputs = buildOutputEntries(baseline);
  const currentOutputs = buildOutputEntries(current);

  const addedNodes = [...currentNodes.entries()]
    .filter(([compareKey]) => !baselineNodes.has(compareKey))
    .map(([compareKey, entry]) => toEntityRef(compareKey, entry.node));

  const removedNodes = [...baselineNodes.entries()]
    .filter(([compareKey]) => !currentNodes.has(compareKey))
    .map(([compareKey, entry]) => toEntityRef(compareKey, entry.node));

  const addedClaims = addedNodes.filter((item) => item.kind && isClaimLikeKind(item.kind));
  const removedClaims = removedNodes.filter((item) => item.kind && isClaimLikeKind(item.kind));

  const addedEdges = [...currentEdges.entries()]
    .filter(([compareKey]) => !baselineEdges.has(compareKey))
    .map(([compareKey, entry]) => toEdgeRef(compareKey, entry));

  const removedEdges = [...baselineEdges.entries()]
    .filter(([compareKey]) => !currentEdges.has(compareKey))
    .map(([compareKey, entry]) => toEdgeRef(compareKey, entry));

  const changedConfidence = collectConfidenceChanges(
    baselineNodes,
    currentNodes,
    baselineEdges,
    currentEdges
  );
  const supportStrengthChanges = collectSupportStrengthChanges(
    baselineEdges,
    currentEdges,
    changedConfidence
  );

  const contradictionChanges = [...new Set([...baselineNodes.keys(), ...currentNodes.keys()])].flatMap(
    (compareKey) => {
      const baselineEntry = baselineNodes.get(compareKey);
      const currentEntry = currentNodes.get(compareKey);
      const before: ReasoningObjectStatus | 'missing' = baselineEntry?.node.status ?? 'missing';
      const after: ReasoningObjectStatus | 'missing' = currentEntry?.node.status ?? 'missing';
      const beforeEdges = baselineEntry?.contradictionEdgeCount ?? 0;
      const afterEdges = currentEntry?.contradictionEdgeCount ?? 0;
      if (before === after && beforeEdges === afterEdges) return [];
      if (!isContradictionLikeStatus(before) && !isContradictionLikeStatus(after) && beforeEdges === 0 && afterEdges === 0) {
        return [];
      }
      const title = currentEntry?.node.title ?? baselineEntry?.node.title ?? compareKey;
      return [{
        compareKey,
        title,
        before,
        after,
        beforeContradictionEdges: beforeEdges,
        afterContradictionEdges: afterEdges
      }];
    }
  );

  const claimDiffs = [...currentNodes.entries()].flatMap<ReasoningObjectClaimDiff>(
    ([compareKey, currentEntry]) => {
      const baselineEntry = baselineNodes.get(compareKey);
      if (!baselineEntry) return [];
      if (!isClaimLikeKind(currentEntry.node.kind) && !isClaimLikeKind(baselineEntry.node.kind)) {
        return [];
      }

      const evidenceDiff = diffSets(baselineEntry.evidenceSet, currentEntry.evidenceSet);
      const provenanceDiff = diffSets(baselineEntry.provenanceSet, currentEntry.provenanceSet);
      const justificationDiff = diffSets(
        baselineEntry.justificationSet,
        currentEntry.justificationSet
      );
      const confidenceChanged = baselineEntry.node.confidence !== currentEntry.node.confidence;
      const supportChanged =
        baselineEntry.supportEdgeCount !== currentEntry.supportEdgeCount ||
        baselineEntry.contradictionEdgeCount !== currentEntry.contradictionEdgeCount;

      if (
        !confidenceChanged &&
        !supportChanged &&
        evidenceDiff.added.length === 0 &&
        evidenceDiff.removed.length === 0 &&
        provenanceDiff.added.length === 0 &&
        provenanceDiff.removed.length === 0 &&
        justificationDiff.added.length === 0 &&
        justificationDiff.removed.length === 0
      ) {
        return [];
      }

      return [{
        compareKey,
        title: currentEntry.node.title,
        kind: currentEntry.node.kind,
        baselineNodeId: baselineEntry.node.id,
        currentNodeId: currentEntry.node.id,
        baselineConfidence: baselineEntry.node.confidence,
        currentConfidence: currentEntry.node.confidence,
        evidenceAdded: evidenceDiff.added,
        evidenceRemoved: evidenceDiff.removed,
        provenanceAdded: provenanceDiff.added,
        provenanceRemoved: provenanceDiff.removed,
        justificationPathAdded: justificationDiff.added,
        justificationPathRemoved: justificationDiff.removed,
        baselineSupportEdgeCount: baselineEntry.supportEdgeCount,
        currentSupportEdgeCount: currentEntry.supportEdgeCount,
        baselineContradictionEdgeCount: baselineEntry.contradictionEdgeCount,
        currentContradictionEdgeCount: currentEntry.contradictionEdgeCount
      }];
    }
  );

  const evidenceSetDiffs: ReasoningObjectEvidenceSetDiff[] = claimDiffs
    .filter((item) => item.evidenceAdded.length > 0 || item.evidenceRemoved.length > 0)
    .map((item) => ({
      ownerCompareKey: item.compareKey,
      ownerTitle: item.title,
      addedEvidence: item.evidenceAdded,
      removedEvidence: item.evidenceRemoved
    }));

  const provenanceDiffs: ReasoningObjectProvenanceDiff[] = claimDiffs
    .filter((item) => item.provenanceAdded.length > 0 || item.provenanceRemoved.length > 0)
    .map((item) => ({
      ownerCompareKey: item.compareKey,
      ownerTitle: item.title,
      addedProvenance: item.provenanceAdded,
      removedProvenance: item.provenanceRemoved
    }));

  const justificationPathDiffs: ReasoningObjectJustificationPathDiff[] = claimDiffs
    .filter((item) => item.justificationPathAdded.length > 0 || item.justificationPathRemoved.length > 0)
    .map((item) => ({
      ownerCompareKey: item.compareKey,
      ownerTitle: item.title,
      addedPaths: item.justificationPathAdded,
      removedPaths: item.justificationPathRemoved
    }));

  const outputDiffs = collectOutputDiffs(baselineOutputs, currentOutputs);

  const notes = [...new Set([
    ...baseline.graph.missingData,
    ...current.graph.missingData
  ])];

  const summaryParts = [
    `${addedClaims.length} added claims`,
    `${removedClaims.length} removed claims`,
    `${evidenceSetDiffs.length} evidence deltas`,
    `${provenanceDiffs.length} provenance deltas`,
    `${justificationPathDiffs.length} path deltas`
  ];
  if (contradictionChanges.length > 0) {
    summaryParts.push(`${contradictionChanges.length} contradiction changes`);
  }
  if (supportStrengthChanges.length > 0) {
    summaryParts.push(`${supportStrengthChanges.length} support-strength changes`);
  }
  if (outputDiffs.length > 0) {
    summaryParts.push(`${outputDiffs.length} output changes`);
  }

  return {
    addedNodes,
    removedNodes,
    addedClaims,
    removedClaims,
    addedEdges,
    removedEdges,
    changedConfidence,
    supportStrengthChanges,
    contradictionChanges,
    claimDiffs,
    evidenceSetDiffs,
    provenanceDiffs,
    justificationPathDiffs,
    outputDiffs,
    summary: summaryParts.join(' · '),
    notes
  };
}
