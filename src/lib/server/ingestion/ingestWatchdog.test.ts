import { afterEach, describe, expect, it } from 'vitest';
import {
  getIngestWatchdogIdleMs,
  ingestWatchdogRequeueJobItems
} from './ingestWatchdog';
import { parseIngestTelemetryPayloadLine } from './ingestionTelemetry';

describe('ingest watchdog env', () => {
  afterEach(() => {
    delete process.env.INGEST_WATCHDOG_IDLE_MS;
    delete process.env.INGEST_WATCHDOG_REQUEUE;
  });

  it('defaults to 5 minutes when unset', () => {
    expect(getIngestWatchdogIdleMs()).toBe(300_000);
  });

  it('disables when INGEST_WATCHDOG_IDLE_MS=0', () => {
    process.env.INGEST_WATCHDOG_IDLE_MS = '0';
    expect(getIngestWatchdogIdleMs()).toBe(0);
  });

  it('treats below-minimum values as default 5 minutes', () => {
    process.env.INGEST_WATCHDOG_IDLE_MS = '59000';
    expect(getIngestWatchdogIdleMs()).toBe(300_000);
  });

  it('respects INGEST_WATCHDOG_IDLE_MS when >= 60s', () => {
    process.env.INGEST_WATCHDOG_IDLE_MS = '600000';
    expect(getIngestWatchdogIdleMs()).toBe(600_000);
  });

  it('clamps very large idle to 24h', () => {
    process.env.INGEST_WATCHDOG_IDLE_MS = '999999999';
    expect(getIngestWatchdogIdleMs()).toBe(86_400_000);
  });

  it('parses INGEST_WATCHDOG_REQUEUE', () => {
    expect(ingestWatchdogRequeueJobItems()).toBe(false);
    process.env.INGEST_WATCHDOG_REQUEUE = '1';
    expect(ingestWatchdogRequeueJobItems()).toBe(true);
  });
});

describe('ingestion telemetry line', () => {
  it('parses payload from emit format', () => {
    const line =
      '[INGEST_TELEMETRY] {"event":"model_call_end","stage":"extract","duration_ms":120,"ts_ms":1}';
    const o = parseIngestTelemetryPayloadLine(line);
    expect(o?.event).toBe('model_call_end');
    expect(o?.stage).toBe('extract');
    expect(o?.duration_ms).toBe(120);
  });

  it('returns null for non-telemetry lines', () => {
    expect(parseIngestTelemetryPayloadLine('hello')).toBeNull();
    expect(parseIngestTelemetryPayloadLine('[INGEST_TELEMETRY] {')).toBeNull();
  });
});
