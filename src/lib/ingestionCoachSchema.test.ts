import { describe, expect, it } from 'vitest';
import { clampCoachBatchOverrideValue, clampCoachOutput, COACH_SCHEMA } from './ingestionCoachSchema';

describe('clampCoachBatchOverrideValue', () => {
  it('clamps extraction max tokens per section', () => {
    expect(clampCoachBatchOverrideValue('extractionMaxTokensPerSection', 500)).toBe(1000);
    expect(clampCoachBatchOverrideValue('extractionMaxTokensPerSection', 50000)).toBe(20_000);
  });
});

describe('clampCoachOutput', () => {
  it('infers uiVariableId for batch_override', () => {
    const raw = COACH_SCHEMA.parse({
      executiveSummary: 'x',
      recommendations: ['a'],
      priority: 'low',
      settingTweaks: [
        {
          scope: 'batch_override',
          label: 'Smaller sections',
          detail: 'd',
          confidence: 0.8,
          batchOverrideKey: 'extractionMaxTokensPerSection',
          batchOverrideValue: 12000
        }
      ]
    });
    const out = clampCoachOutput(raw);
    expect(out.settingTweaks?.[0]?.uiVariableId).toBe('batch_extractionMaxTokensPerSection');
  });
});
