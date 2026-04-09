import { describe, expect, it } from 'vitest';
import { GraphEdgeSchema, GraphNodeSchema, AnalyseRequestSchema } from '@restormel/contracts/api';
import { PhaseOneClaimMetadataSchema } from '@restormel/contracts/ingestion';
import { ReasoningObjectSnapshotDiffSchema } from '@restormel/contracts/reasoning-compare';
import { ReasoningLineageReportSchema } from '@restormel/contracts/reasoning-lineage';
import { ReasoningObjectSnapshotSchema } from '@restormel/contracts/reasoning-object';
import { ClaimSchema, RelationBundleSchema } from '@restormel/contracts/references';
import { NormalizedRunTraceSchema } from '@restormel/contracts/trace-ingestion';

/** Consumer contract tests against published `@restormel/contracts` (npm). */
describe('@restormel/contracts schemas (npm)', () => {
  it('parses core graph contracts', () => {
    const node = GraphNodeSchema.parse({
      id: 'claim:a',
      type: 'claim',
      label: 'Claim A',
      phase: 'analysis',
      confidenceBand: 'high'
    });

    const edge = GraphEdgeSchema.parse({
      from: 'claim:a',
      to: 'claim:b',
      type: 'supports',
      relation_confidence: 0.8
    });

    expect(node.type).toBe('claim');
    expect(edge.type).toBe('supports');
  });

  it('parses shared reference and ingestion contracts', () => {
    const claim = ClaimSchema.parse({
      id: 'c1',
      text: 'Public reason constrains coercive law.',
      badge: 'thesis',
      source: 'Rawls, Political Liberalism',
      tradition: 'Liberalism',
      detail: 'A concise restatement of the position.',
      phase: 'analysis'
    });

    const relationBundle = RelationBundleSchema.parse({
      claimId: 'c1',
      relations: [{ type: 'supports', target: 'c2', label: 'backs' }]
    });

    const metadata = PhaseOneClaimMetadataSchema.parse({
      claim_origin: 'source_grounded',
      claim_scope: 'normative',
      attributed_to: ['John Rawls'],
      concept_tags: ['public reason'],
      verification_state: 'unverified',
      review_state: 'candidate',
      extractor_version: 'v1',
      contested_terms: []
    });

    expect(claim.id).toBe('c1');
    expect(relationBundle.relations).toHaveLength(1);
    expect(metadata.claim_origin).toBe('source_grounded');
  });

  it('accepts null for optional metadata strings on PhaseOneClaimMetadataSchema', () => {
    const metadata = PhaseOneClaimMetadataSchema.parse({
      claim_origin: 'source_grounded',
      claim_scope: 'normative',
      attributed_to: ['Author'],
      concept_tags: ['tag'],
      verification_state: 'unverified',
      review_state: 'candidate',
      extractor_version: 'v1',
      contested_terms: [],
      thinker: null,
      tradition: null,
      era: null,
      subdomain: null
    });
    expect(metadata.thinker).toBeUndefined();
    expect(metadata.tradition).toBeUndefined();
    expect(metadata.era).toBeUndefined();
    expect(metadata.subdomain).toBeUndefined();
  });

  it('validates analyse request link preferences', () => {
    const request = AnalyseRequestSchema.parse({
      query: 'What is public reason?',
      domain: 'ethics',
      link_preferences: [
        {
          url: 'https://example.com/source',
          ingest_selected: true,
          ingest_visibility: 'public_shared'
        }
      ]
    });

    expect(request.query).toContain('public reason');
  });

  it('parses canonical reasoning-object snapshots', () => {
    const snapshot = ReasoningObjectSnapshotSchema.parse({
      version: {
        schemaVersion: 1,
        source: 'adapter',
        snapshotId: 'snapshot:test'
      },
      graph: {
        nodes: [
          {
            id: 'claim:a',
            kind: 'claim',
            title: 'Claim A',
            status: 'default',
            tags: ['analysis'],
            searchText: 'Claim A analysis',
            classification: {
              kind: 'claim',
              confidence: 'high',
              reason: 'Claim node',
              missingSignals: []
            },
            metadata: {
              derivedFromIds: [],
              compareKey: 'claim|claim a',
              extra: {}
            },
            provenance: [],
            evidence: []
          }
        ],
        edges: [
          {
            id: 'claim:a:supports:claim:b',
            from: 'claim:a',
            to: 'claim:b',
            kind: 'supports',
            status: 'default',
            metadata: {
              derivedFromIds: [],
              evidenceSources: [],
              compareKey: 'supports|claim a|claim b',
              extra: {}
            },
            provenance: [],
            evidence: []
          }
        ],
        missingData: []
      },
      trace: [
        {
          id: 'snapshot',
          kind: 'snapshot-captured',
          title: 'Snapshot',
          summary: 'Graph snapshot',
          status: 'complete',
          source: 'graph-derived',
          sequence: 1,
          facts: []
        }
      ],
      outputs: []
    });

    expect(snapshot.graph.nodes[0]?.metadata.compareKey).toBe('claim|claim a');
  });

  it('parses graph-aware reasoning evaluation findings', () => {
    const snapshot = ReasoningObjectSnapshotSchema.parse({
      version: {
        schemaVersion: 1,
        source: 'adapter',
        snapshotId: 'snapshot:test'
      },
      graph: {
        nodes: [],
        edges: [],
        missingData: []
      },
      trace: [],
      outputs: [],
      evaluation: {
        flaggedNodeIds: [],
        validationDeltas: [],
        notes: [],
        graphSummary: {
          overallStatus: 'warning',
          totalFindings: 1,
          warningCount: 1,
          errorCount: 0,
          topLine: '1 issue detected.'
        },
        graphFindings: [
          {
            id: 'finding:1',
            kind: 'unsupported-claim',
            severity: 'warning',
            title: 'Claim lacks explicit support',
            summary: 'Claim A has no visible supporting relation.',
            nodeIds: ['claim:a'],
            edgeIds: []
          }
        ]
      }
    });

    expect(snapshot.evaluation?.graphFindings[0]?.kind).toBe('unsupported-claim');
  });

  it('parses reasoning-state compare contracts', () => {
    const diff = ReasoningObjectSnapshotDiffSchema.parse({
      addedNodes: [],
      removedNodes: [],
      addedClaims: [
        {
          compareKey: 'claim|claim b',
          objectId: 'claim:b',
          title: 'Claim B',
          kind: 'claim'
        }
      ],
      removedClaims: [],
      addedEdges: [],
      removedEdges: [],
      changedConfidence: [],
      supportStrengthChanges: [
        {
          compareKey: 'supports|claim a|claim b',
          target: 'edge',
          title: 'Claim A supports Claim B',
          before: 0.4,
          after: 0.8
        }
      ],
      contradictionChanges: [],
      claimDiffs: [
        {
          compareKey: 'claim|claim a',
          title: 'Claim A',
          kind: 'claim',
          baselineNodeId: 'claim:a:before',
          currentNodeId: 'claim:a:after',
          baselineConfidence: 0.5,
          currentConfidence: 0.9,
          evidenceAdded: ['source|source b'],
          evidenceRemoved: [],
          provenanceAdded: ['url|https example com'],
          provenanceRemoved: [],
          justificationPathAdded: ['in|supports|claim|claim b'],
          justificationPathRemoved: [],
          baselineSupportEdgeCount: 0,
          currentSupportEdgeCount: 1,
          baselineContradictionEdgeCount: 0,
          currentContradictionEdgeCount: 0
        }
      ],
      evidenceSetDiffs: [],
      provenanceDiffs: [],
      justificationPathDiffs: [],
      outputDiffs: [],
      summary: '1 added claim',
      notes: ['Evidence nodes remain sparse in some SOPHIA flows.']
    });

    expect(diff.addedClaims[0]?.compareKey).toBe('claim|claim b');
    expect(diff.supportStrengthChanges[0]?.after).toBe(0.8);
  });

  it('parses reasoning-lineage report contracts', () => {
    const report = ReasoningLineageReportSchema.parse({
      version: {
        schemaVersion: 1,
        artifactVersion: 1
      },
      generatedAt: '2026-03-14T08:00:00.000Z',
      title: 'Restormel decision-lineage report',
      run: {
        source: 'adapter',
        snapshotId: 'snapshot:test',
        queryRunId: 'run:test'
      },
      reasoningSummary: {
        topLine: 'Answer text.',
        nodeCount: 4,
        edgeCount: 3,
        claimCount: 2,
        evidenceBackedClaimCount: 1,
        contradictionCount: 0,
        outputCount: 1,
        evaluationFindingCount: 0
      },
      justifications: [
        {
          compareKey: 'claim|claim a',
          objectId: 'claim:a',
          title: 'Claim A',
          kind: 'claim',
          evidenceCount: 1,
          provenanceCount: 1,
          supportEdgeCount: 1,
          contradictionEdgeCount: 0
        }
      ],
      contradictions: [],
      provenanceBundle: {
        totalItems: 1,
        uniqueSourceRefs: 1,
        missingProvenanceCount: 0,
        items: [
          {
            provenanceId: 'prov:1',
            kind: 'url',
            label: 'Source URL',
            value: 'https://example.com/source',
            usageCount: 1,
            objectIds: ['claim:a'],
            sourceRefs: [{ kind: 'url', value: 'https://example.com/source' }]
          }
        ]
      },
      compareSummary: {
        summary: '1 evidence delta',
        addedClaims: 0,
        removedClaims: 0,
        evidenceDeltaCount: 1,
        provenanceDeltaCount: 0,
        contradictionChangeCount: 0,
        supportStrengthChangeCount: 0,
        outputChangeCount: 0,
        notes: []
      },
      notes: ['Structured provenance is available for this node.']
    });

    expect(report.provenanceBundle.totalItems).toBe(1);
    expect(report.justifications[0]?.title).toBe('Claim A');
  });

  it('parses normalized trace-ingestion contracts', () => {
    const trace = NormalizedRunTraceSchema.parse({
      schemaVersion: 1,
      source: 'openinference',
      producer: {
        ecosystem: 'openinference',
        name: 'openinference-compatible'
      },
      traceId: 'trace:test',
      spans: [
        {
          id: 'span:run',
          traceId: 'trace:test',
          name: 'reasoning run',
          kind: 'run',
          status: 'ok',
          startTime: '2026-03-14T07:00:00.000Z',
          attributes: {}
        }
      ],
      events: [
        {
          id: 'event:1',
          traceId: 'trace:test',
          kind: 'run-start',
          name: 'reasoning run',
          timestamp: '2026-03-14T07:00:00.000Z',
          status: 'ok',
          sequence: 1,
          attributes: {},
          objectRefs: []
        }
      ]
    });

    expect(trace.producer.ecosystem).toBe('openinference');
  });
});
