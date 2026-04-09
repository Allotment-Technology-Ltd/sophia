import { describe, expect, it } from 'vitest';
import {
  eventsToTrace,
  normalizeOpenInferenceLikeTrace,
  normalizeRunTrace,
  normalizeSophiaReasoningEvents,
  normalizedTraceToReasoningObjectEvents,
  parseReasoningEventBlock,
  sampleOpenInferenceLikeTrace,
  sampleSophiaReasoningEvents,
  serializeReasoningEvent,
  traceToEvents
} from '@restormel/observability';

/** Consumer tests against published `@restormel/observability` (npm). */
describe('@restormel/observability (npm)', () => {
  it('serializes and parses SSE reasoning events', () => {
    const payload = serializeReasoningEvent(sampleSophiaReasoningEvents[0]);
    const parsed = parseReasoningEventBlock(payload);

    expect(parsed).toEqual(sampleSophiaReasoningEvents[0]);
  });

  it('round-trips a saved SOPHIA event stream through RunTrace', () => {
    const trace = eventsToTrace(sampleSophiaReasoningEvents, {
      source: 'cached',
      runId: 'run:sample-1',
      query: 'What is public reason?'
    });

    const replayed = traceToEvents(trace);

    expect(trace.snapshots).toHaveLength(1);
    expect(replayed).toEqual(sampleSophiaReasoningEvents);
  });

  it('normalizes SOPHIA event streams and cached run traces into a canonical trace format', () => {
    const runTrace = eventsToTrace(sampleSophiaReasoningEvents, {
      source: 'cached',
      runId: 'run:sample-1',
      query: 'What is public reason?'
    });

    const normalizedFromEvents = normalizeSophiaReasoningEvents(sampleSophiaReasoningEvents, {
      runId: 'run:sample-1',
      query: 'What is public reason?'
    });
    const normalizedFromRunTrace = normalizeRunTrace(runTrace);

    expect(normalizedFromEvents.events[0]?.kind).toBe('pass-start');
    expect(normalizedFromRunTrace.source).toBe('sophia-run-trace');
    expect(normalizedFromRunTrace.events.some((event) => event.kind === 'graph-snapshot')).toBe(true);
  });

  it('maps a foreign openinference-like trace into the canonical format and reasoning timeline events', () => {
    const normalized = normalizeOpenInferenceLikeTrace(sampleOpenInferenceLikeTrace);
    const reasoningEvents = normalizedTraceToReasoningObjectEvents(normalized);

    expect(normalized.source).toBe('openinference');
    expect(normalized.spans).toHaveLength(3);
    expect(reasoningEvents[0]?.kind).toBe('query-received');
    expect(reasoningEvents.some((event) => event.kind === 'validation-run')).toBe(true);
  });
});
