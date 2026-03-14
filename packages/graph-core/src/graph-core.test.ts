import { describe, expect, it } from 'vitest';
import { diffReasoningSnapshots } from './compare';
import { diffGraphs } from './diff';
import { evaluateReasoningGraph } from './evaluation';
import { computeLayout } from './layout';
import { buildReasoningLineageReport, renderReasoningLineageMarkdown } from './lineage';
import { projectGraph } from './projection';
import { summarizeGraph } from './summary';
import {
  buildReadabilityWarnings,
  collectEdgeKinds,
  collectNeighborhoodScope,
  collectNodeKinds,
  filterGraph,
  isolateGraphToScope
} from './workspace';

const retrievalFixture = {
  claims: [
    {
      id: 'a',
      text: 'Claim A',
      claim_type: 'thesis',
      domain: 'ethics',
      source_title: 'Source A',
      source_author: ['Author A'],
      confidence: 0.82
    },
    {
      id: 'b',
      text: 'Claim B',
      claim_type: 'premise',
      domain: 'ethics',
      source_title: 'Source B',
      source_author: ['Author B'],
      confidence: 0.76
    }
  ],
  relations: [
    {
      from_index: 0,
      to_index: 1,
      relation_type: 'supports',
      strength: 'strong' as const,
      note: 'A supports B'
    }
  ],
  arguments: [],
  seed_claim_ids: ['a'],
  degraded: false
};

describe('@restormel/graph-core', () => {
  it('projects retrieval-like input into a graph snapshot', () => {
    const snapshot = projectGraph(retrievalFixture);

    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.edges.some((edge) => edge.type === 'supports')).toBe(true);
    expect(snapshot.meta?.seedNodeIds).toEqual(['claim:a']);
  });

  it('summarizes and diffs graph snapshots', () => {
    const before = projectGraph(retrievalFixture);
    const after = {
      ...before,
      nodes: [...before.nodes, { id: 'claim:c', type: 'claim', label: 'Claim C' }]
    };

    const summary = summarizeGraph(before);
    const diff = diffGraphs(before, after);

    expect(summary.nodeCount).toBe(4);
    expect(diff.addedNodeIds).toContain('claim:c');
  });

  it('computes deterministic positions for visible nodes', () => {
    const snapshot = projectGraph(retrievalFixture);
    const layout = computeLayout(snapshot.nodes, snapshot.edges, 800, 600);

    expect(layout.get('source:Source A')).toBeTruthy();
    expect(layout.get('claim:a')).toBeTruthy();
  });

  it('filters and scopes compiled graph state without renderer coupling', () => {
    const snapshot = projectGraph(retrievalFixture);
    const graph = {
      nodes: snapshot.nodes.map((node) => ({
        ...node,
        kind: node.type,
        searchText: `${node.label} ${node.sourceTitle ?? ''}`.trim()
      })),
      edges: snapshot.edges.map((edge) => ({
        ...edge,
        id: `${edge.from}:${edge.type}:${edge.to}`,
        kind: edge.type
      })),
      ghostNodes: snapshot.meta?.rejectedNodes ?? [],
      ghostEdges: snapshot.meta?.rejectedEdges ?? []
    };

    const filtered = filterGraph(
      graph,
      {
        search: 'claim a',
        phase: 'all',
        density: 'comfortable',
        nodeKinds: collectNodeKinds(graph.nodes),
        edgeKinds: collectEdgeKinds(graph.edges),
        showGhosts: true
      },
      'claim:a',
      {
        comfortableHiddenEdgeKinds: ['contains']
      }
    );
    const scope = collectNeighborhoodScope(filtered, 'claim:a', 1);
    const isolated = isolateGraphToScope(filtered, scope);

    expect(filtered.nodes.some((node) => node.id === 'claim:a')).toBe(true);
    expect(scope.nodeIds).toContain('claim:a');
    expect(isolated.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('computes readability warnings from compiled graph state', () => {
    const warnings = buildReadabilityWarnings(
      {
        nodes: Array.from({ length: 36 }, (_, index) => ({
          id: `node:${index}`,
          kind: index === 0 ? 'source' : 'claim',
          searchText: `node ${index}`
        })),
        edges: Array.from({ length: 40 }, (_, index) => ({
          id: `edge:${index}`,
          from: `node:${index % 10}`,
          to: `node:${(index + 1) % 10}`,
          kind: index % 2 === 0 ? 'supports' : 'contains'
        }))
      },
      {
        sourceNodeKinds: ['source'],
        structuralEdgeKinds: ['contains']
      }
    );

    expect(warnings.length).toBeGreaterThan(0);
  });

  it('evaluates graph-native reasoning issues from a reasoning-object snapshot', () => {
    const evaluation = evaluateReasoningGraph({
      graph: {
        nodes: [
          {
            id: 'claim:a',
            kind: 'claim',
            title: 'Claim A',
            status: 'default',
            tags: [],
            searchText: 'Claim A',
            classification: {
              kind: 'claim',
              confidence: 'high',
              reason: 'claim',
              missingSignals: []
            },
            metadata: {
              derivedFromIds: [],
              compareKey: 'claim|claim a',
              extra: {}
            },
            provenance: [],
            evidence: []
          },
          {
            id: 'claim:conclusion',
            kind: 'synthesis',
            title: 'Conclusion',
            status: 'default',
            confidence: 0.4,
            tags: [],
            searchText: 'Conclusion',
            classification: {
              kind: 'synthesis',
              confidence: 'medium',
              reason: 'synthesis',
              missingSignals: []
            },
            metadata: {
              derivedFromIds: ['claim:missing'],
              compareKey: 'synthesis|conclusion',
              extra: {}
            },
            provenance: [],
            evidence: []
          }
        ],
        edges: [],
        missingData: []
      },
      outputs: []
    });

    expect(evaluation.summary.totalFindings).toBeGreaterThan(0);
    expect(evaluation.findings.some((finding) => finding.kind === 'unsupported-claim')).toBe(true);
    expect(
      evaluation.findings.some((finding) => finding.kind === 'conclusion-confidence-gap')
    ).toBe(true);
    expect(
      evaluation.findings.some((finding) => finding.kind === 'disconnected-justification-path')
    ).toBe(true);
  });

  it('diffs reasoning-object snapshots for claims, evidence, provenance, paths, and outputs', () => {
    const baseline = {
      version: {
        schemaVersion: 1,
        source: 'adapter' as const,
        snapshotId: 'snapshot:before',
        queryRunId: 'run:before'
      },
      graph: {
        nodes: [
          {
            id: 'claim:a:before',
            kind: 'claim' as const,
            title: 'Claim A',
            status: 'default' as const,
            confidence: 0.52,
            tags: [],
            searchText: 'Claim A',
            classification: {
              kind: 'claim' as const,
              confidence: 'high' as const,
              reason: 'claim',
              missingSignals: []
            },
            metadata: {
              derivedFromIds: [],
              compareKey: 'claim|claim a',
              extra: {}
            },
            provenance: [],
            evidence: [
              {
                id: 'evidence:1',
                kind: 'source' as const,
                label: 'Source',
                summary: 'Source A'
              }
            ]
          }
        ],
        edges: [],
        missingData: ['Baseline graph lacks explicit evidence nodes.']
      },
      trace: [],
      outputs: [
        {
          id: 'output:before',
          kind: 'final-output' as const,
          title: 'Answer',
          text: 'Before answer',
          derivedNodeIds: ['claim:a:before']
        }
      ]
    };

    const current = {
      version: {
        schemaVersion: 1,
        source: 'adapter' as const,
        snapshotId: 'snapshot:after',
        queryRunId: 'run:after'
      },
      graph: {
        nodes: [
          {
            id: 'claim:a:after',
            kind: 'claim' as const,
            title: 'Claim A',
            status: 'contradicted' as const,
            confidence: 0.81,
            tags: [],
            searchText: 'Claim A',
            classification: {
              kind: 'claim' as const,
              confidence: 'high' as const,
              reason: 'claim',
              missingSignals: []
            },
            metadata: {
              derivedFromIds: [],
              compareKey: 'claim|claim a',
              extra: {}
            },
            provenance: [
              {
                id: 'prov:1',
                kind: 'url' as const,
                label: 'Source URL',
                value: 'https://example.com/source-a',
                sourceRefs: [{ kind: 'url' as const, value: 'https://example.com/source-a' }]
              }
            ],
            evidence: [
              {
                id: 'evidence:1',
                kind: 'source' as const,
                label: 'Source',
                summary: 'Source A'
              },
              {
                id: 'evidence:2',
                kind: 'quote' as const,
                label: 'Quote',
                summary: 'Source B excerpt',
                sourceTitle: 'Source B'
              }
            ]
          },
          {
            id: 'claim:b',
            kind: 'claim' as const,
            title: 'Claim B',
            status: 'default' as const,
            tags: [],
            searchText: 'Claim B',
            classification: {
              kind: 'claim' as const,
              confidence: 'high' as const,
              reason: 'claim',
              missingSignals: []
            },
            metadata: {
              derivedFromIds: [],
              compareKey: 'claim|claim b',
              extra: {}
            },
            provenance: [],
            evidence: []
          }
        ],
        edges: [
          {
            id: 'edge:1',
            from: 'claim:b',
            to: 'claim:a:after',
            kind: 'supports' as const,
            status: 'default' as const,
            confidence: 0.87,
            metadata: {
              derivedFromIds: [],
              evidenceSources: [],
              compareKey: 'supports|claim b|claim a',
              extra: {}
            },
            provenance: [],
            evidence: []
          },
          {
            id: 'edge:2',
            from: 'claim:b',
            to: 'claim:a:after',
            kind: 'contradicts' as const,
            status: 'contradicted' as const,
            confidence: 0.71,
            metadata: {
              derivedFromIds: [],
              evidenceSources: [],
              compareKey: 'contradicts|claim b|claim a',
              extra: {}
            },
            provenance: [],
            evidence: []
          }
        ],
        missingData: []
      },
      trace: [],
      outputs: [
        {
          id: 'output:after',
          kind: 'final-output' as const,
          title: 'Answer',
          text: 'After answer',
          confidence: 0.84,
          derivedNodeIds: ['claim:a:after', 'claim:b']
        }
      ]
    };

    const diff = diffReasoningSnapshots(baseline, current);

    expect(diff.addedClaims.map((item) => item.compareKey)).toContain('claim|claim b');
    expect(diff.claimDiffs[0]?.evidenceAdded.length).toBe(1);
    expect(diff.claimDiffs[0]?.provenanceAdded.length).toBe(1);
    expect(diff.justificationPathDiffs[0]?.addedPaths.length).toBeGreaterThan(0);
    expect(diff.supportStrengthChanges.length).toBe(1);
    expect(diff.contradictionChanges.length).toBe(2);
    expect(diff.outputDiffs[0]?.textChanged).toBe(true);
  });

  it('builds an audit-ready reasoning-lineage report and markdown export', () => {
    const snapshot = {
      version: {
        schemaVersion: 1,
        source: 'adapter' as const,
        snapshotId: 'snapshot:lineage',
        queryRunId: 'run:lineage',
        generatedAt: '2026-03-14T08:00:00.000Z'
      },
      graph: {
        nodes: [
          {
            id: 'claim:1',
            kind: 'synthesis' as const,
            title: 'Synthesized answer',
            status: 'default' as const,
            confidence: 0.88,
            tags: [],
            searchText: 'Synthesized answer',
            classification: {
              kind: 'synthesis' as const,
              confidence: 'high' as const,
              reason: 'synthesis',
              missingSignals: []
            },
            metadata: {
              derivedFromIds: [],
              compareKey: 'synthesis|synthesized answer',
              extra: {}
            },
            provenance: [
              {
                id: 'prov:lineage',
                kind: 'url' as const,
                label: 'Source URL',
                value: 'https://example.com/source',
                sourceRefs: [{ kind: 'url' as const, value: 'https://example.com/source' }]
              }
            ],
            evidence: [
              {
                id: 'evidence:lineage',
                kind: 'quote' as const,
                label: 'Quote',
                summary: 'Primary source excerpt',
                sourceTitle: 'Source A'
              }
            ]
          },
          {
            id: 'claim:2',
            kind: 'contradiction' as const,
            title: 'Counter-position',
            status: 'contradicted' as const,
            tags: [],
            searchText: 'Counter-position',
            classification: {
              kind: 'contradiction' as const,
              confidence: 'medium' as const,
              reason: 'contradiction',
              missingSignals: []
            },
            metadata: {
              derivedFromIds: [],
              compareKey: 'contradiction|counter position',
              extra: {}
            },
            provenance: [],
            evidence: []
          }
        ],
        edges: [
          {
            id: 'edge:supports',
            from: 'claim:1',
            to: 'claim:2',
            kind: 'supports' as const,
            status: 'default' as const,
            metadata: {
              derivedFromIds: [],
              evidenceSources: [],
              compareKey: 'supports|synthesized answer|counter position',
              extra: {}
            },
            provenance: [],
            evidence: []
          },
          {
            id: 'edge:contradicts',
            from: 'claim:2',
            to: 'claim:1',
            kind: 'contradicts' as const,
            status: 'contradicted' as const,
            metadata: {
              derivedFromIds: [],
              evidenceSources: [],
              compareKey: 'contradicts|counter position|synthesized answer',
              extra: {}
            },
            provenance: [],
            evidence: []
          }
        ],
        missingData: ['Inference nodes remain implicit in this snapshot.']
      },
      trace: [],
      outputs: [
        {
          id: 'output:1',
          kind: 'final-output' as const,
          title: 'Answer',
          text: 'Final answer text.',
          derivedNodeIds: ['claim:1']
        }
      ],
      evaluation: {
        flaggedNodeIds: ['claim:2'],
        validationDeltas: [],
        notes: [],
        graphFindings: []
      }
    };

    const report = buildReasoningLineageReport({ snapshot });
    const markdown = renderReasoningLineageMarkdown(report);

    expect(report.reasoningSummary.nodeCount).toBe(2);
    expect(report.justifications[0]?.title).toBe('Synthesized answer');
    expect(report.contradictions.length).toBeGreaterThan(0);
    expect(report.provenanceBundle.totalItems).toBe(1);
    expect(markdown).toContain('## Evidence-backed justifications');
    expect(markdown).toContain('## Provenance bundle');
  });
});
