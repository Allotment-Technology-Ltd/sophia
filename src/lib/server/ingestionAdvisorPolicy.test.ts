import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getAdvisorAutoApplyFields,
  getIngestionAdvisorMode,
  heuristicPresetFromPreScan,
  resolveAdvisorApply,
  clampAdvisorOutput
} from './ingestionAdvisorPolicy';

describe('getIngestionAdvisorMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to off', () => {
    vi.stubEnv('INGESTION_ADVISOR_MODE', '');
    expect(getIngestionAdvisorMode()).toBe('off');
  });

  it('accepts shadow and auto (case-insensitive)', () => {
    vi.stubEnv('INGESTION_ADVISOR_MODE', 'SHADOW');
    expect(getIngestionAdvisorMode()).toBe('shadow');
    vi.stubEnv('INGESTION_ADVISOR_MODE', 'Auto');
    expect(getIngestionAdvisorMode()).toBe('auto');
  });

  it('maps unknown values to off', () => {
    vi.stubEnv('INGESTION_ADVISOR_MODE', 'banana');
    expect(getIngestionAdvisorMode()).toBe('off');
  });
});

describe('getAdvisorAutoApplyFields', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to preset and validation', () => {
    vi.stubEnv('INGESTION_ADVISOR_AUTO_APPLY', '');
    const s = getAdvisorAutoApplyFields();
    expect(s.has('preset')).toBe(true);
    expect(s.has('validation')).toBe(true);
  });

  it('parses comma list', () => {
    vi.stubEnv('INGESTION_ADVISOR_AUTO_APPLY', 'preset');
    const s = getAdvisorAutoApplyFields();
    expect(s.has('preset')).toBe(true);
    expect(s.has('validation')).toBe(false);
  });
});

describe('heuristicPresetFromPreScan', () => {
  it('always recommends production; validation scales with source size', () => {
    const small = heuristicPresetFromPreScan(1000);
    expect(small.recommendedPreset).toBe('production');
    expect(small.suggestCrossModelValidation).toBe(false);

    const medium = heuristicPresetFromPreScan(50_000);
    expect(medium.recommendedPreset).toBe('production');
    expect(medium.suggestCrossModelValidation).toBe(true);

    const large = heuristicPresetFromPreScan(100_000);
    expect(large.recommendedPreset).toBe('production');
    expect(large.suggestCrossModelValidation).toBe(true);
  });

  it('clamps non-positive token input', () => {
    const h = heuristicPresetFromPreScan(0);
    expect(h.recommendedPreset).toBe('production');
  });
});

describe('resolveAdvisorApply', () => {
  const baseline = heuristicPresetFromPreScan(20_000);
  const suggestion = {
    recommendedPreset: 'production' as const,
    confidence: 0.9,
    rationale: 'test',
    suggestCrossModelValidation: false
  };

  it('shadow uses baseline only', () => {
    const r = resolveAdvisorApply('shadow', suggestion, baseline, new Set(['preset', 'validation']));
    expect(r.appliedPreset).toBe(baseline.recommendedPreset);
    expect(r.autoAppliedPreset).toBe(false);
    expect(r.shadowDiff.presetChangedVsHeuristic).toBe(false);
  });

  it('auto applies allowlisted fields', () => {
    const r = resolveAdvisorApply('auto', suggestion, baseline, new Set(['preset', 'validation']));
    expect(r.appliedPreset).toBe('production');
    expect(r.appliedValidation).toBe(false);
    expect(r.autoAppliedPreset).toBe(true);
    expect(r.autoAppliedValidation).toBe(true);
  });

  it('auto respects preset-only allowlist', () => {
    const r = resolveAdvisorApply('auto', suggestion, baseline, new Set(['preset']));
    expect(r.appliedPreset).toBe('production');
    expect(r.appliedValidation).toBe(baseline.suggestCrossModelValidation);
    expect(r.autoAppliedValidation).toBe(false);
  });
});

describe('clampAdvisorOutput', () => {
  it('normalizes legacy preset strings to production', () => {
    const o = {
      recommendedPreset: 'balanced' as const,
      confidence: 0.5,
      rationale: 'ok',
      suggestCrossModelValidation: true
    };
    expect(clampAdvisorOutput(o).recommendedPreset).toBe('production');
  });

  it('repairs invalid input', () => {
    const c = clampAdvisorOutput({ nonsense: true });
    expect(c.recommendedPreset).toBe('production');
    expect(c.rationale).toContain('safe defaults');
  });
});
