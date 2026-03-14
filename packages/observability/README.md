# @restormel/observability

Shared trace and event-shaping utilities for Restormel runtime flows.

## Current exports

- `eventsToTrace(events, options)`
- `traceToEvents(trace)`
- `normalizeSophiaReasoningEvents(events, options)`
- `normalizeRunTrace(trace)`
- `normalizeOpenInferenceLikeTrace(trace)`
- `normalizedTraceToReasoningObjectEvents(trace)`
- `serializeReasoningEvent(event)`
- `parseReasoningEventBlock(block)`

## Example

```ts
import {
  eventsToTrace,
  normalizeRunTrace,
  normalizedTraceToReasoningObjectEvents,
  traceToEvents
} from '@restormel/observability';

const trace = eventsToTrace(events, { source: 'sse', runId: 'run:123' });
const replay = traceToEvents(trace);
const normalized = normalizeRunTrace(trace);
const timeline = normalizedTraceToReasoningObjectEvents(normalized);
```

## Scope

- This package normalizes existing trace/event producers into a canonical Restormel trace format.
- It does not implement a tracing backend, storage system, or observability dashboard.
