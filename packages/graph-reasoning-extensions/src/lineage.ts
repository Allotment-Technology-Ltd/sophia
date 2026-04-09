import type {
  ReasoningLineageCompareSummary,
  ReasoningLineageContradictionItem,
  ReasoningLineageJustificationItem,
  ReasoningLineageProvenanceItem,
  ReasoningLineageReport,
  ReasoningObjectSnapshot,
  ReasoningObjectSnapshotDiff
} from '@restormel/contracts';

const CLAIM_LIKE_KINDS = new Set(['claim', 'synthesis', 'conclusion', 'contradiction']);
const SUPPORT_EDGE_KINDS = new Set([
  'supports',
  'derived-from',
  'inferred-by',
  'depends-on',
  'responds-to',
  'resolves',
  'defines',
  'qualifies',
  'assumes',
  'cites',
  'retrieved-from'
]);

function clip(value: string, max = 140): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function summarizePrimaryEvidence(
  node: ReasoningObjectSnapshot['graph']['nodes'][number]
): string | undefined {
  const primary = node.evidence[0];
  if (!primary) return undefined;
  const title = primary.sourceTitle ? `${primary.sourceTitle}: ` : '';
  return clip(`${title}${primary.summary}`);
}

function buildConnectedEdgeCounts(
  snapshot: ReasoningObjectSnapshot
): Map<string, { supportEdgeCount: number; contradictionEdgeCount: number }> {
  const counts = new Map<string, { supportEdgeCount: number; contradictionEdgeCount: number }>();

  function ensure(nodeId: string) {
    if (!counts.has(nodeId)) {
      counts.set(nodeId, { supportEdgeCount: 0, contradictionEdgeCount: 0 });
    }
    return counts.get(nodeId)!;
  }

  for (const edge of snapshot.graph.edges) {
    const fromCounts = ensure(edge.from);
    const toCounts = ensure(edge.to);
    if (SUPPORT_EDGE_KINDS.has(edge.kind)) {
      fromCounts.supportEdgeCount += 1;
      toCounts.supportEdgeCount += 1;
    }
    if (edge.kind === 'contradicts' || edge.kind === 'unresolved') {
      fromCounts.contradictionEdgeCount += 1;
      toCounts.contradictionEdgeCount += 1;
    }
  }

  return counts;
}

function buildJustifications(
  snapshot: ReasoningObjectSnapshot,
  maxItems: number
): ReasoningLineageJustificationItem[] {
  const counts = buildConnectedEdgeCounts(snapshot);

  return snapshot.graph.nodes
    .filter((node) => CLAIM_LIKE_KINDS.has(node.kind))
    .map((node) => {
      const edgeCounts = counts.get(node.id) ?? { supportEdgeCount: 0, contradictionEdgeCount: 0 };
      return {
        compareKey: node.metadata.compareKey,
        objectId: node.id,
        title: node.title,
        kind: node.kind,
        phase: node.phase,
        confidence: node.confidence,
        evidenceCount: node.evidence.length,
        provenanceCount: node.provenance.length,
        supportEdgeCount: edgeCounts.supportEdgeCount,
        contradictionEdgeCount: edgeCounts.contradictionEdgeCount,
        primaryEvidence: summarizePrimaryEvidence(node),
        rationale:
          node.classification.reason ||
          (node.provenance[0]?.rationale ? clip(node.provenance[0].rationale) : undefined)
      };
    })
    .sort((a, b) => {
      const aScore =
        (a.kind === 'synthesis' || a.kind === 'conclusion' ? 5 : 0) +
        (a.evidenceCount * 3) +
        (a.provenanceCount * 2) +
        a.supportEdgeCount +
        (a.confidence ?? 0);
      const bScore =
        (b.kind === 'synthesis' || b.kind === 'conclusion' ? 5 : 0) +
        (b.evidenceCount * 3) +
        (b.provenanceCount * 2) +
        b.supportEdgeCount +
        (b.confidence ?? 0);
      return bScore - aScore;
    })
    .slice(0, maxItems);
}

function buildContradictions(
  snapshot: ReasoningObjectSnapshot,
  maxItems: number
): ReasoningLineageContradictionItem[] {
  const counts = buildConnectedEdgeCounts(snapshot);

  return snapshot.graph.nodes
    .filter((node) => {
      const edgeCounts = counts.get(node.id);
      return node.status === 'contradicted' || node.status === 'unresolved' || (edgeCounts?.contradictionEdgeCount ?? 0) > 0;
    })
    .map((node) => {
      const edgeCounts = counts.get(node.id) ?? { supportEdgeCount: 0, contradictionEdgeCount: 0 };
      return {
        compareKey: node.metadata.compareKey,
        objectId: node.id,
        title: node.title,
        status: node.status,
        contradictionEdgeCount: edgeCounts.contradictionEdgeCount,
        supportEdgeCount: edgeCounts.supportEdgeCount,
        note:
          node.status === 'contradicted'
            ? 'Marked as contradicted in the current reasoning state.'
            : node.status === 'unresolved'
              ? 'Marked as unresolved in the current reasoning state.'
              : 'Connected contradiction edges are present.'
      };
    })
    .sort((a, b) => b.contradictionEdgeCount - a.contradictionEdgeCount)
    .slice(0, maxItems);
}

function buildProvenanceBundle(
  snapshot: ReasoningObjectSnapshot,
  maxItems: number
): ReasoningLineageReport['provenanceBundle'] {
  const byId = new Map<string, ReasoningLineageProvenanceItem>();
  let missingProvenanceCount = 0;

  for (const node of snapshot.graph.nodes) {
    if (node.provenance.length === 0 && CLAIM_LIKE_KINDS.has(node.kind)) {
      missingProvenanceCount += 1;
    }

    for (const provenance of node.provenance) {
      const existing = byId.get(provenance.id);
      if (existing) {
        existing.usageCount += 1;
        if (!existing.objectIds.includes(node.id)) existing.objectIds.push(node.id);
        continue;
      }

      byId.set(provenance.id, {
        provenanceId: provenance.id,
        kind: provenance.kind,
        label: provenance.label,
        value: provenance.value,
        pass: provenance.pass,
        queryRunId: provenance.queryRunId,
        usageCount: 1,
        objectIds: [node.id],
        sourceRefs: provenance.sourceRefs
      });
    }
  }

  for (const edge of snapshot.graph.edges) {
    for (const provenance of edge.provenance) {
      const existing = byId.get(provenance.id);
      if (existing) {
        existing.usageCount += 1;
        if (!existing.objectIds.includes(edge.id)) existing.objectIds.push(edge.id);
        continue;
      }

      byId.set(provenance.id, {
        provenanceId: provenance.id,
        kind: provenance.kind,
        label: provenance.label,
        value: provenance.value,
        pass: provenance.pass,
        queryRunId: provenance.queryRunId,
        usageCount: 1,
        objectIds: [edge.id],
        sourceRefs: provenance.sourceRefs
      });
    }
  }

  const items = [...byId.values()]
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, maxItems);

  const uniqueSourceRefs = new Set(
    [...byId.values()].flatMap((item) => item.sourceRefs.map((ref) => `${ref.kind}:${ref.value}`))
  );

  return {
    totalItems: byId.size,
    uniqueSourceRefs: uniqueSourceRefs.size,
    missingProvenanceCount,
    items
  };
}

function buildCompareSummary(
  compareDiff?: ReasoningObjectSnapshotDiff
): ReasoningLineageCompareSummary | undefined {
  if (!compareDiff) return undefined;

  return {
    summary: compareDiff.summary,
    addedClaims: compareDiff.addedClaims.length,
    removedClaims: compareDiff.removedClaims.length,
    evidenceDeltaCount: compareDiff.evidenceSetDiffs.length,
    provenanceDeltaCount: compareDiff.provenanceDiffs.length,
    contradictionChangeCount: compareDiff.contradictionChanges.length,
    supportStrengthChangeCount: compareDiff.supportStrengthChanges.length,
    outputChangeCount: compareDiff.outputDiffs.length,
    notes: compareDiff.notes
  };
}

export function buildReasoningLineageReport(params: {
  snapshot: ReasoningObjectSnapshot;
  compareDiff?: ReasoningObjectSnapshotDiff;
  title?: string;
  generatedAt?: string;
  maxItems?: number;
}): ReasoningLineageReport {
  const maxItems = params.maxItems ?? 6;
  const snapshot = params.snapshot;
  const justifications = buildJustifications(snapshot, maxItems);
  const contradictions = buildContradictions(snapshot, maxItems);
  const provenanceBundle = buildProvenanceBundle(snapshot, maxItems);
  const evaluationFindingCount = snapshot.evaluation?.graphFindings.length ?? 0;
  const evidenceBackedClaimCount = snapshot.graph.nodes.filter(
    (node) => CLAIM_LIKE_KINDS.has(node.kind) && (node.evidence.length > 0 || node.provenance.length > 0)
  ).length;

  const notes = [
    ...snapshot.graph.missingData,
    ...(provenanceBundle.missingProvenanceCount > 0
      ? [`${provenanceBundle.missingProvenanceCount} claim-like nodes still lack structured provenance in this snapshot.`]
      : []),
    ...(params.compareDiff ? ['Compare summary reflects reasoning-state deltas, not frame-by-frame replay.'] : [])
  ];

  return {
    version: {
      schemaVersion: snapshot.version.schemaVersion,
      artifactVersion: 1
    },
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    title: params.title ?? 'Restormel decision-lineage report',
    run: {
      source: snapshot.version.source,
      runId: snapshot.version.runId,
      queryRunId: snapshot.version.queryRunId,
      snapshotId: snapshot.version.snapshotId,
      parentSnapshotId: snapshot.version.parentSnapshotId,
      passSequence: snapshot.version.passSequence,
      generatedAt: snapshot.version.generatedAt
    },
    reasoningSummary: {
      topLine:
        snapshot.outputs[0]?.text
          ? clip(snapshot.outputs[0].text, 180)
          : `Reasoning snapshot with ${snapshot.graph.nodes.length} nodes and ${snapshot.graph.edges.length} edges.`,
      nodeCount: snapshot.graph.nodes.length,
      edgeCount: snapshot.graph.edges.length,
      claimCount: snapshot.graph.nodes.filter((node) => CLAIM_LIKE_KINDS.has(node.kind)).length,
      evidenceBackedClaimCount,
      contradictionCount: contradictions.length,
      outputCount: snapshot.outputs.length,
      evaluationFindingCount
    },
    justifications,
    contradictions,
    provenanceBundle,
    compareSummary: buildCompareSummary(params.compareDiff),
    notes
  };
}

export function renderReasoningLineageMarkdown(report: ReasoningLineageReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Run source: ${report.run.source}`);
  if (report.run.queryRunId) lines.push(`Query run: ${report.run.queryRunId}`);
  if (report.run.snapshotId) lines.push(`Snapshot: ${report.run.snapshotId}`);
  lines.push('');

  lines.push('## Reasoning summary');
  lines.push('');
  lines.push(report.reasoningSummary.topLine);
  lines.push('');
  lines.push(`- Nodes: ${report.reasoningSummary.nodeCount}`);
  lines.push(`- Edges: ${report.reasoningSummary.edgeCount}`);
  lines.push(`- Claim-like objects: ${report.reasoningSummary.claimCount}`);
  lines.push(`- Evidence-backed claim-like objects: ${report.reasoningSummary.evidenceBackedClaimCount}`);
  lines.push(`- Contradiction items: ${report.reasoningSummary.contradictionCount}`);
  lines.push(`- Outputs: ${report.reasoningSummary.outputCount}`);
  lines.push(`- Evaluation findings: ${report.reasoningSummary.evaluationFindingCount}`);
  lines.push('');

  lines.push('## Evidence-backed justifications');
  lines.push('');
  if (report.justifications.length === 0) {
    lines.push('- No claim-like justification objects were available.');
  } else {
    for (const item of report.justifications) {
      lines.push(`- ${item.title} (${item.kind})`);
      lines.push(
        `  confidence=${item.confidence?.toFixed(2) ?? 'n/a'}, evidence=${item.evidenceCount}, provenance=${item.provenanceCount}, support_edges=${item.supportEdgeCount}, contradiction_edges=${item.contradictionEdgeCount}`
      );
      if (item.primaryEvidence) lines.push(`  primary_evidence=${item.primaryEvidence}`);
      if (item.rationale) lines.push(`  rationale=${item.rationale}`);
    }
  }
  lines.push('');

  lines.push('## Contradiction summary');
  lines.push('');
  if (report.contradictions.length === 0) {
    lines.push('- No contradiction items were identified in the current snapshot.');
  } else {
    for (const item of report.contradictions) {
      lines.push(
        `- ${item.title}: status=${item.status}, contradiction_edges=${item.contradictionEdgeCount}, support_edges=${item.supportEdgeCount}`
      );
      lines.push(`  note=${item.note}`);
    }
  }
  lines.push('');

  lines.push('## Provenance bundle');
  lines.push('');
  lines.push(`- Total provenance items: ${report.provenanceBundle.totalItems}`);
  lines.push(`- Unique source refs: ${report.provenanceBundle.uniqueSourceRefs}`);
  lines.push(`- Missing provenance on claim-like objects: ${report.provenanceBundle.missingProvenanceCount}`);
  for (const item of report.provenanceBundle.items) {
    lines.push(`- ${item.label}: ${clip(item.value)}`);
    lines.push(`  kind=${item.kind}, usage=${item.usageCount}, objects=${item.objectIds.join(', ')}`);
  }
  lines.push('');

  if (report.compareSummary) {
    lines.push('## Run comparison summary');
    lines.push('');
    lines.push(report.compareSummary.summary);
    lines.push('');
    lines.push(`- Added claims: ${report.compareSummary.addedClaims}`);
    lines.push(`- Removed claims: ${report.compareSummary.removedClaims}`);
    lines.push(`- Evidence deltas: ${report.compareSummary.evidenceDeltaCount}`);
    lines.push(`- Provenance deltas: ${report.compareSummary.provenanceDeltaCount}`);
    lines.push(`- Contradiction changes: ${report.compareSummary.contradictionChangeCount}`);
    lines.push(`- Support-strength changes: ${report.compareSummary.supportStrengthChangeCount}`);
    lines.push(`- Output changes: ${report.compareSummary.outputChangeCount}`);
    if (report.compareSummary.notes.length > 0) {
      for (const note of report.compareSummary.notes) {
        lines.push(`- Note: ${note}`);
      }
    }
    lines.push('');
  }

  if (report.notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
