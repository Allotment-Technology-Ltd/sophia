import type { ReasoningEvent } from '@restormel/contracts';
import type { OpenInferenceLikeTraceInput } from './normalize';

export const sampleSophiaReasoningEvents: ReasoningEvent[] = [
  { type: 'pass_start', pass: 'analysis' },
  {
    type: 'graph_snapshot',
    version: 1,
    nodes: [
      {
        id: 'source:Rawls',
        type: 'source',
        label: 'Political Liberalism (Rawls)',
        phase: 'retrieval',
        pass_origin: 'retrieval',
        conflict_status: 'none'
      },
      {
        id: 'claim:c1',
        type: 'claim',
        label: 'Public reason constrains coercive law.',
        phase: 'retrieval',
        sourceTitle: 'Political Liberalism',
        isSeed: true,
        pass_origin: 'retrieval',
        conflict_status: 'none'
      }
    ],
    edges: [
      {
        from: 'source:Rawls',
        to: 'claim:c1',
        type: 'contains',
        pass_origin: 'retrieval',
        conflict_status: 'none'
      }
    ],
    meta: {
      seedNodeIds: ['claim:c1'],
      query_run_id: 'run:sample-1',
      retrievalTimestamp: '2026-03-14T07:00:00.000Z'
    }
  },
  {
    type: 'metadata',
    total_input_tokens: 1200,
    total_output_tokens: 600,
    duration_ms: 4200,
    query_run_id: 'run:sample-1'
  },
  {
    type: 'reasoning_quality',
    reasoning_quality: {
      overall_score: 0.82,
      dimensions: [
        { dimension: 'logical_structure', score: 0.8, explanation: 'Sound structure.' },
        { dimension: 'evidence_grounding', score: 0.84, explanation: 'Grounded.' },
        { dimension: 'counterargument_coverage', score: 0.79, explanation: 'Some objections covered.' },
        { dimension: 'scope_calibration', score: 0.83, explanation: 'Calibrated.' },
        { dimension: 'assumption_transparency', score: 0.81, explanation: 'Mostly explicit.' },
        { dimension: 'internal_consistency', score: 0.85, explanation: 'Consistent.' }
      ]
    }
  }
];

export const sampleOpenInferenceLikeTrace: OpenInferenceLikeTraceInput = {
  traceId: 'trace:openinference:sample-1',
  runId: 'run:openinference:sample-1',
  query: 'What is public reason?',
  spans: [
    {
      id: 'span:run',
      name: 'reasoning run',
      startTime: '2026-03-14T07:00:00.000Z',
      endTime: '2026-03-14T07:00:05.000Z',
      status: 'ok',
      attributes: { phase: 'retrieval' }
    },
    {
      id: 'span:retrieval',
      parentId: 'span:run',
      name: 'retrieval pass',
      startTime: '2026-03-14T07:00:00.500Z',
      endTime: '2026-03-14T07:00:02.000Z',
      status: 'ok',
      attributes: { phase: 'retrieval', document_count: 6 }
    },
    {
      id: 'span:verification',
      parentId: 'span:run',
      name: 'verification pass',
      startTime: '2026-03-14T07:00:03.000Z',
      endTime: '2026-03-14T07:00:04.500Z',
      status: 'warning',
      attributes: { phase: 'verification', flagged_claims: 1 }
    }
  ]
};
