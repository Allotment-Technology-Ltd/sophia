import { afterEach, describe, expect, it } from 'vitest';
import {
  ingestCurrentStageToTimingKey,
  ingestWatchdogListQueryIdleMs,
  isPastWatchdogThreshold,
  resolveWatchdogIdleThresholdMs
} from './ingestWatchdogPhaseBaselines';
import type { IdleStalledIngestCandidateRow } from '../db/ingestRunRepository';

describe('ingestWatchdogPhaseBaselines', () => {
  afterEach(() => {
    delete process.env.INGEST_WATCHDOG_PHASE_IDLE_JSON;
    delete process.env.INGEST_WATCHDOG_PHASE_BASELINE_MULT;
  });

  it('maps current_stage_key to timing keys', () => {
    expect(ingestCurrentStageToTimingKey('extract')).toBe('extracting');
    expect(ingestCurrentStageToTimingKey('remediation')).toBe('remediating');
  });

  it('uses INGEST_WATCHDOG_PHASE_IDLE_JSON when set', () => {
    process.env.INGEST_WATCHDOG_PHASE_IDLE_JSON = JSON.stringify({ extracting: 120_000 });
    const row: IdleStalledIngestCandidateRow = {
      id: 'x',
      currentStageKey: 'extract',
      createdAtMs: 0,
      lastOutputAt: null,
      workerHeartbeatAt: null,
      lastIngestTimingLine: null
    };
    expect(resolveWatchdogIdleThresholdMs(300_000, row)).toBe(120_000);
  });

  it('widens list query idle when phase map has smaller thresholds', () => {
    process.env.INGEST_WATCHDOG_PHASE_IDLE_JSON = JSON.stringify({ extracting: 120_000 });
    expect(ingestWatchdogListQueryIdleMs(300_000)).toBe(120_000);
  });

  it('isPastWatchdogThreshold respects worker heartbeat', () => {
    const now = 1_000_000;
    const row: IdleStalledIngestCandidateRow = {
      id: 'x',
      currentStageKey: 'extract',
      createdAtMs: now - 600_000,
      lastOutputAt: now - 400_000,
      workerHeartbeatAt: now - 100_000,
      lastIngestTimingLine: null
    };
    expect(isPastWatchdogThreshold(now, row, 300_000)).toBe(false);
  });
});
