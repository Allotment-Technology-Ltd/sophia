import { describe, expect, it } from 'vitest';
import { adaptSophiaReasoningObjectBundle } from '$lib/graph-kit/adapters/sophiaReasoningObjectAdapter';
import { normalizeOpenInferenceLikeTrace } from '@restormel/observability';

describe('adaptSophiaReasoningObjectBundle', () => {
  it('maps SOPHIA graph snapshots into canonical reasoning objects', () => {
    const bundle = adaptSophiaReasoningObjectBundle({
      nodes: [
        {
          id: 'claim:a',
          type: 'claim',
          label: 'A synthesis claim',
          phase: 'synthesis',
          pass_origin: 'synthesis',
          confidenceBand: 'high',
          evidence_strength: 0.88,
          provenance_id: 'prov-1'
        },
        {
          id: 'source:1',
          type: 'source',
          label: 'Primary source',
          sourceTitle: 'Primary source'
        }
      ],
      edges: [
        {
          from: 'source:1',
          to: 'claim:a',
          type: 'supports',
          relation_confidence: 0.8,
          evidence_sources: ['Primary source excerpt']
        }
      ],
      meta: {
        snapshot_id: 'snapshot:test',
        query_run_id: 'run:test',
        retrievalTimestamp: '2026-03-14T12:00:00.000Z',
        retrievalTrace: {
          seedPoolCount: 8,
          selectedSeedCount: 4,
          traversedClaimCount: 6,
          relationCandidateCount: 10,
          relationKeptCount: 5,
          argumentCandidateCount: 3,
          argumentKeptCount: 2,
          closureStats: {
            majorThesisCount: 1,
            unitsAttempted: 2,
            unitsCompleted: 2,
            claimsAddedForClosure: 1,
            objectionsAdded: 1,
            repliesAdded: 1,
            capLimitedUnits: 0
          }
        }
      },
      traceContext: {
        queryText: 'What follows from the source?',
        finalOutputText: 'Final synthesis output.',
        reasoningQuality: {
          overall_score: 0.84,
          dimensions: [
            { dimension: 'logical_structure', score: 0.8, explanation: 'Good.' },
            { dimension: 'evidence_grounding', score: 0.86, explanation: 'Good.' },
            { dimension: 'counterargument_coverage', score: 0.79, explanation: 'Good.' },
            { dimension: 'scope_calibration', score: 0.83, explanation: 'Good.' },
            { dimension: 'assumption_transparency', score: 0.85, explanation: 'Good.' },
            { dimension: 'internal_consistency', score: 0.88, explanation: 'Good.' }
          ]
        },
        sources: [
          {
            id: 'src-1',
            title: 'Supplementary source record',
            author: ['Test Author'],
            claimCount: 2,
            groundingConfidence: {
              score: 0.81,
              supportingUris: ['https://example.com/source-record']
            }
          }
        ],
        groundingSources: [
          {
            pass: 'analysis',
            url: 'https://example.com/analysis',
            title: 'Analysis grounding'
          },
          {
            pass: 'verification',
            url: 'https://example.com/verification',
            title: 'Verification grounding'
          }
        ]
      }
    });

    expect(bundle.snapshot.version.snapshotId).toBe('snapshot:test');
    expect(bundle.snapshot.graph.nodes[0]?.kind).toBe('synthesis');
    expect(bundle.snapshot.graph.nodes[0]?.metadata.compareKey).toContain('synthesis|');
    expect(bundle.snapshot.graph.edges[0]?.metadata.compareKey).toContain('supports|');
    expect(bundle.snapshot.graph.nodes.some((node) => node.kind === 'query')).toBe(true);
    expect(bundle.snapshot.graph.nodes.some((node) => node.kind === 'evidence')).toBe(true);
    expect(bundle.snapshot.graph.nodes.some((node) => node.kind === 'inference')).toBe(true);
    expect(bundle.snapshot.graph.nodes.some((node) => node.kind === 'conclusion')).toBe(true);
    expect(bundle.snapshot.graph.edges.some((edge) => edge.kind === 'cites')).toBe(true);
    expect(bundle.snapshot.graph.edges.some((edge) => edge.kind === 'qualifies')).toBe(true);
    expect(bundle.snapshot.trace.some((event) => event.kind === 'query-received')).toBe(true);
    expect(bundle.snapshot.outputs[0]?.kind).toBe('final-output');
    expect(bundle.snapshot.graph.missingData.some((note) => note.includes('Evidence is available only'))).toBe(false);
  });

  it('accepts canonical normalized traces from non-SOPHIA producers', () => {
    const bundle = adaptSophiaReasoningObjectBundle({
      nodes: [],
      edges: [],
      traceContext: {
        normalizedTrace: normalizeOpenInferenceLikeTrace({
          traceId: 'trace:foreign',
          spans: [
            {
              id: 'span:run',
              name: 'reasoning run',
              startTime: '2026-03-14T12:00:00.000Z',
              endTime: '2026-03-14T12:00:05.000Z',
              status: 'ok'
            },
            {
              id: 'span:verify',
              parentId: 'span:run',
              name: 'verification pass',
              startTime: '2026-03-14T12:00:03.000Z',
              endTime: '2026-03-14T12:00:04.000Z',
              status: 'warning',
              attributes: { phase: 'verification' }
            }
          ]
        })
      }
    });

    expect(bundle.snapshot.trace[0]?.kind).toBe('query-received');
    expect(bundle.snapshot.trace.some((event) => event.kind === 'validation-run')).toBe(true);
  });
});
