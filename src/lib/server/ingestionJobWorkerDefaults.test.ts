import { describe, expect, it } from 'vitest';
import { sanitizeIngestionJobWorkerDefaults } from './ingestionJobWorkerDefaults';

describe('sanitizeIngestionJobWorkerDefaults', () => {
  it('returns undefined for empty', () => {
    expect(sanitizeIngestionJobWorkerDefaults(undefined)).toBeUndefined();
    expect(sanitizeIngestionJobWorkerDefaults({})).toBeUndefined();
  });

  it('keeps bounded numeric fields', () => {
    const o = sanitizeIngestionJobWorkerDefaults({
      extractionConcurrency: 4,
      passageInsertConcurrency: 10,
      claimInsertConcurrency: 16,
      remediationMaxClaims: 20,
      globalMaxConcurrentTogether: 2,
      globalMaxConcurrentVoyage: 1,
      relateStoreConcurrency: 4
    });
    expect(o?.extractionConcurrency).toBe(4);
    expect(o?.passageInsertConcurrency).toBe(10);
    expect(o?.claimInsertConcurrency).toBe(16);
    expect(o?.remediationMaxClaims).toBe(20);
    expect(o?.globalMaxConcurrentTogether).toBe(2);
    expect(o?.globalMaxConcurrentVoyage).toBe(1);
    expect(o?.relateStoreConcurrency).toBe(4);
  });

  it('drops out-of-range values', () => {
    expect(
      sanitizeIngestionJobWorkerDefaults({ extractionConcurrency: 99 })?.extractionConcurrency
    ).toBeUndefined();
    expect(
      sanitizeIngestionJobWorkerDefaults({ passageInsertConcurrency: 20 })?.passageInsertConcurrency
    ).toBeUndefined();
  });

  it('normalizes watchdog JSON string', () => {
    const o = sanitizeIngestionJobWorkerDefaults({
      watchdogPhaseIdleJson: '{"extracting": 120000}'
    });
    expect(o?.watchdogPhaseIdleJson).toBe('{"extracting":120000}');
  });

  it('accepts mistral ingestProvider', () => {
    const o = sanitizeIngestionJobWorkerDefaults({ ingestProvider: 'mistral' });
    expect(o?.ingestProvider).toBe('mistral');
  });

  it('passes forceReingest for durable-job re-ingest', () => {
    const o = sanitizeIngestionJobWorkerDefaults({ forceReingest: true });
    expect(o?.forceReingest).toBe(true);
  });

  it('drops forceReingest when forceStage is validating (validation tail)', () => {
    const o = sanitizeIngestionJobWorkerDefaults({
      forceReingest: true,
      forceStage: 'validating'
    });
    expect(o?.forceStage).toBe('validating');
    expect(o?.forceReingest).toBeUndefined();
    expect(o?.forceStageMissingCheckpoint).toBe('resume');
  });

  it('defaults forceStageMissingCheckpoint to resume for validating tail', () => {
    const o = sanitizeIngestionJobWorkerDefaults({ forceStage: 'validating' });
    expect(o?.forceStageMissingCheckpoint).toBe('resume');
  });

  it('honors explicit forceStageMissingCheckpoint for validating', () => {
    const full = sanitizeIngestionJobWorkerDefaults({
      forceStage: 'validating',
      forceStageMissingCheckpoint: 'full'
    });
    expect(full?.forceStageMissingCheckpoint).toBe('full');
    const alias = sanitizeIngestionJobWorkerDefaults({
      forceStage: 'validating',
      ingestForceStageMissingCheckpoint: 'error'
    });
    expect(alias?.forceStageMissingCheckpoint).toBe('error');
  });

  it('accepts Google throughput toggle and extraction floor', () => {
    const o = sanitizeIngestionJobWorkerDefaults({
      googleGenerativeThroughput: false,
      googleExtractionConcurrencyFloor: 8
    });
    expect(o?.googleGenerativeThroughput).toBe(false);
    expect(o?.googleExtractionConcurrencyFloor).toBe(8);
  });

  it('drops Google extraction floor outside 1–12', () => {
    expect(
      sanitizeIngestionJobWorkerDefaults({ googleExtractionConcurrencyFloor: 99 })
        ?.googleExtractionConcurrencyFloor
    ).toBeUndefined();
  });
});
