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
  it('uses budget for small sources', () => {
    const h = heuristicPresetFromPreScan(1000);
    expect(h.recommendedPreset).toBe('budget');
    expect(h.basis).toContain('18k');
  });

  it('uses balanced for mid sources', () => {
    const h = heuristicPresetFromPreScan(50_000);
    expect(h.recommendedPreset).toBe('balanced');
  });

  it('uses complexity for large sources', () => {
    const h = heuristicPresetFromPreScan(100_000);
    expect(h.recommendedPreset).toBe('complexity');
  });

  it('clamps non-positive token input', () => {
    const h = heuristicPresetFromPreScan(0);
    expect(h.recommendedPreset).toBe('budget');
  });
});

describe('resolveAdvisorApply', () => {
  const baseline = heuristicPresetFromPreScan(20_000);
  const suggestion = {
    recommendedPreset: 'complexity' as const,
    confidence: 0.9,
    rationale: 'test',
    suggestCrossModelValidation: false
  };

  it('shadow uses baseline only', () => {
    const r = resolveAdvisorApply('shadow', suggestion, baseline, new Set(['preset', 'validation']));
    expect(r.appliedPreset).toBe(baseline.recommendedPreset);
    expect(r.autoAppliedPreset).toBe(false);
    expect(r.shadowDiff.presetChangedVsHeuristic).toBe(true);
  });

  it('auto applies allowlisted fields', () => {
    const r = resolveAdvisorApply('auto', suggestion, baseline, new Set(['preset', 'validation']));
    expect(r.appliedPreset).toBe('complexity');
    expect(r.appliedValidation).toBe(false);
    expect(r.autoAppliedPreset).toBe(true);
    expect(r.autoAppliedValidation).toBe(true);
  });

  it('auto respects preset-only allowlist', () => {
    const r = resolveAdvisorApply('auto', suggestion, baseline, new Set(['preset']));
    expect(r.appliedPreset).toBe('complexity');
    expect(r.appliedValidation).toBe(baseline.suggestCrossModelValidation);
    expect(r.autoAppliedValidation).toBe(false);
  });
});

describe('clampAdvisorOutput', () => {
  it('returns valid objects unchanged', () => {
    const o = {
      recommendedPreset: 'balanced' as const,
      confidence: 0.5,
      rationale: 'ok',
      suggestCrossModelValidation: true
    };
    expect(clampAdvisorOutput(o)).toEqual(o);
  });

  it('repairs invalid input', () => {
    const c = clampAdvisorOutput({ nonsense: true });
    expect(c.recommendedPreset).toBe('balanced');
    expect(c.rationale).toContain('validation');
  });
});
