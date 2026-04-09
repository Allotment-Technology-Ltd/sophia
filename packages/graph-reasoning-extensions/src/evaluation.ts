import type {
  ReasoningObjectEdge,
  ReasoningObjectGraphEvaluationFinding,
  ReasoningObjectGraphEvaluationSummary,
  ReasoningObjectNode,
  ReasoningObjectSnapshot
} from '@restormel/contracts/reasoning-object';

const CLAIM_LIKE_KINDS = new Set<ReasoningObjectNode['kind']>([
  'claim',
  'contradiction',
  'synthesis',
  'conclusion'
]);
const CONCLUSION_LIKE_KINDS = new Set<ReasoningObjectNode['kind']>(['synthesis', 'conclusion']);
const JUSTIFICATION_EDGE_KINDS = new Set<ReasoningObjectEdge['kind']>([
  'supports',
  'cites',
  'retrieved-from',
  'contains',
  'derived-from',
  'inferred-by'
]);
const SUPPORT_EDGE_KINDS = new Set<ReasoningObjectEdge['kind']>([
  'supports',
  'cites',
  'retrieved-from',
  'contains',
  'derived-from',
  'inferred-by'
]);

export interface ReasoningGraphEvaluationResult {
  summary: ReasoningObjectGraphEvaluationSummary;
  findings: ReasoningObjectGraphEvaluationFinding[];
}

function makeFinding(
  finding: Omit<ReasoningObjectGraphEvaluationFinding, 'id'>
): ReasoningObjectGraphEvaluationFinding {
  const key = `${finding.kind}:${finding.nodeIds.join(',')}:${finding.edgeIds.join(',')}:${finding.title}`;
  return {
    id: key,
    ...finding
  };
}

function claimLikeNodes(nodes: ReasoningObjectNode[]): ReasoningObjectNode[] {
  return nodes.filter((node) => CLAIM_LIKE_KINDS.has(node.kind));
}

function distinctSourcesForNode(node: ReasoningObjectNode): Set<string> {
  const sources = new Set<string>();
  if (node.sourceLabel) sources.add(node.sourceLabel);
  if (node.metadata.sourceTitle) sources.add(node.metadata.sourceTitle);
  for (const item of node.evidence) {
    if (item.sourceTitle) sources.add(item.sourceTitle);
  }
  return sources;
}

function connectedEdges(
  edges: ReasoningObjectEdge[],
  nodeId: string
): ReasoningObjectEdge[] {
  return edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
}

function supportingEdges(
  edges: ReasoningObjectEdge[],
  nodeId: string
): ReasoningObjectEdge[] {
  return edges.filter(
    (edge) =>
      edge.to === nodeId &&
      SUPPORT_EDGE_KINDS.has(edge.kind)
  );
}

function hasEvidence(node: ReasoningObjectNode, edges: ReasoningObjectEdge[]): boolean {
  if (node.evidence.length > 0) return true;
  if (node.sourceLabel || node.metadata.sourceTitle) return true;
  return connectedEdges(edges, node.id).some(
    (edge) =>
      (edge.evidenceCount ?? 0) > 0 ||
      edge.evidence.length > 0 ||
      edge.metadata.evidenceSources.length > 0
  );
}

function hasSupport(node: ReasoningObjectNode, edges: ReasoningObjectEdge[]): boolean {
  return supportingEdges(edges, node.id).length > 0;
}

function buildReverseJustificationAdjacency(
  edges: ReasoningObjectEdge[]
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!JUSTIFICATION_EDGE_KINDS.has(edge.kind)) continue;
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.to)?.push(edge.from);
  }
  return adjacency;
}

function hasPathToSource(
  node: ReasoningObjectNode,
  nodesById: Map<string, ReasoningObjectNode>,
  reverseAdjacency: Map<string, string[]>
): boolean {
  if (node.kind === 'source') return true;
  const visited = new Set<string>([node.id]);
  const queue = [node.id];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const prev of reverseAdjacency.get(current) ?? []) {
      if (visited.has(prev)) continue;
      visited.add(prev);
      const prevNode = nodesById.get(prev);
      if (prevNode?.kind === 'source') return true;
      queue.push(prev);
    }
  }

  return false;
}

export function evaluateReasoningGraph(
  snapshot: Pick<ReasoningObjectSnapshot, 'graph' | 'outputs'>
): ReasoningGraphEvaluationResult {
  const findings: ReasoningObjectGraphEvaluationFinding[] = [];
  const nodes = snapshot.graph.nodes;
  const edges = snapshot.graph.edges;
  const claimNodes = claimLikeNodes(nodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const reverseAdjacency = buildReverseJustificationAdjacency(edges);

  for (const node of claimNodes) {
    const incidentEdges = connectedEdges(edges, node.id);

    if (!hasSupport(node, edges)) {
      findings.push(
        makeFinding({
          kind: 'unsupported-claim',
          severity: 'warning',
          title: 'Claim lacks explicit support',
          summary: `${node.title} has no visible supporting relation under the current graph model.`,
          rationale: 'Current SOPHIA graph snapshots often expose support through relations or evidence-linked source structure.',
          nodeIds: [node.id],
          edgeIds: []
        })
      );
    }

    if (!hasEvidence(node, edges)) {
      findings.push(
        makeFinding({
          kind: 'claim-without-evidence',
          severity: 'warning',
          title: 'Claim lacks evidence',
          summary: `${node.title} has no explicit evidence item, source label, or evidence-bearing edge.`,
          rationale: 'This is credible today because the workspace already exposes evidence and source metadata when present.',
          nodeIds: [node.id],
          edgeIds: incidentEdges.map((edge) => edge.id)
        })
      );
    }

    if (node.provenance.length === 0 && !node.metadata.provenanceId) {
      findings.push(
        makeFinding({
          kind: 'missing-provenance',
          severity: 'warning',
          title: 'Missing provenance',
          summary: `${node.title} has no structured provenance payload in the current snapshot.`,
          rationale: 'Provenance IDs are frequently sparse in current SOPHIA graph snapshots.',
          nodeIds: [node.id],
          edgeIds: []
        })
      );
    }

    if (node.metadata.derivedFromIds.length > 0) {
      const unresolvedRefs = node.metadata.derivedFromIds.filter((id) => !nodesById.has(id));
      if (unresolvedRefs.length > 0) {
        findings.push(
          makeFinding({
            kind: 'unresolved-inference-chain',
            severity: 'warning',
            title: 'Inference chain is unresolved',
            summary: `${node.title} references derived inputs that are not present in the current graph snapshot.`,
            rationale: 'Derived-from references are available today, but referenced upstream nodes are not always materialized.',
            nodeIds: [node.id],
            edgeIds: [],
            metricValue: unresolvedRefs.length
          })
        );
      }
    }

    if (CONCLUSION_LIKE_KINDS.has(node.kind) && (node.confidence ?? 0) < 0.65) {
      findings.push(
        makeFinding({
          kind: 'conclusion-confidence-gap',
          severity: 'warning',
          title: 'Conclusion confidence gap',
          summary: `${node.title} is conclusion-like but has missing or weak confidence.`,
          rationale: 'Current synthesis/conclusion nodes can carry confidence; low values should be visible to the workspace.',
          nodeIds: [node.id],
          edgeIds: [],
          metricValue: node.confidence,
          threshold: 0.65
        })
      );
    }

    if (!hasPathToSource(node, nodesById, reverseAdjacency)) {
      findings.push(
        makeFinding({
          kind: 'disconnected-justification-path',
          severity: 'error',
          title: 'Disconnected justification path',
          summary: `${node.title} has no visible justification path back to a source node.`,
          rationale: 'This graph-native check is one of the clearest differentiated evaluation primitives Restormel can offer.',
          nodeIds: [node.id],
          edgeIds: []
        })
      );
    }
  }

  const contradictionEdges = edges.filter(
    (edge) => edge.kind === 'contradicts' || edge.kind === 'unresolved'
  );
  const contradictionNodes = nodes.filter(
    (node) => node.status === 'contradicted' || node.status === 'unresolved'
  );
  const contradictionDensity =
    nodes.length > 0 ? (contradictionNodes.length + contradictionEdges.length) / nodes.length : 0;
  if (contradictionNodes.length > 0 || contradictionEdges.length > 0) {
    findings.push(
      makeFinding({
        kind: 'contradiction-density',
        severity: contradictionDensity >= 0.25 ? 'warning' : 'info',
        title: 'Contradiction pressure present',
        summary: `${contradictionNodes.length} nodes and ${contradictionEdges.length} edges are contradiction-marked.`,
        rationale: 'The current graph exposes contradiction markers directly via node status and contradiction-like edge kinds.',
        nodeIds: contradictionNodes.map((node) => node.id),
        edgeIds: contradictionEdges.map((edge) => edge.id),
        metricValue: Number(contradictionDensity.toFixed(3)),
        threshold: 0.25
      })
    );
  }

  const sourceLabels = new Set<string>();
  for (const node of claimNodes) {
    for (const source of distinctSourcesForNode(node)) sourceLabels.add(source);
  }
  if (claimNodes.length >= 4 && sourceLabels.size <= 1) {
    findings.push(
      makeFinding({
        kind: 'weak-source-diversity',
        severity: 'warning',
        title: 'Weak source diversity',
        summary: `Claim-like nodes draw from only ${sourceLabels.size} distinct source context(s).`,
        rationale: 'Current graph snapshots expose enough source-title context to flag mono-source reasoning clusters.',
        nodeIds: claimNodes.map((node) => node.id),
        edgeIds: [],
        metricValue: sourceLabels.size,
        threshold: 2
      })
    );
  }

  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;

  return {
    summary: {
      overallStatus: errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ok',
      totalFindings: findings.length,
      warningCount,
      errorCount,
      topLine:
        findings.length === 0
          ? 'No graph-native reasoning issues were detected in the current snapshot.'
          : `${findings.length} graph-native reasoning issue${findings.length === 1 ? '' : 's'} detected.`
    },
    findings
  };
}

export function findEvaluationFindingsForNode(
  findings: ReasoningObjectGraphEvaluationFinding[],
  nodeId: string
): ReasoningObjectGraphEvaluationFinding[] {
  return findings.filter((finding) => finding.nodeIds.includes(nodeId));
}
