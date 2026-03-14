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
        retrievalTimestamp: '2026-03-14T12:00:00.000Z'
      },
      traceContext: {
        queryText: 'What follows from the source?',
        finalOutputText: 'Final synthesis output.'
      }
    });

    expect(bundle.snapshot.version.snapshotId).toBe('snapshot:test');
    expect(bundle.snapshot.graph.nodes[0]?.kind).toBe('synthesis');
    expect(bundle.snapshot.graph.nodes[0]?.metadata.compareKey).toContain('synthesis|');
    expect(bundle.snapshot.graph.edges[0]?.metadata.compareKey).toContain('supports|');
    expect(bundle.snapshot.trace.some((event) => event.kind === 'query-received')).toBe(true);
    expect(bundle.snapshot.outputs[0]?.kind).toBe('final-output');
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
