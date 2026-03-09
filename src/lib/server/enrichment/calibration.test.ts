import { describe, expect, it } from 'vitest';
import { calibrateRelationConfidence } from './calibration';

describe('calibrateRelationConfidence', () => {
  it('returns high band for strong signals', () => {
    const result = calibrateRelationConfidence({
      extractionConfidence: 0.95,
      sourceCredibility: 0.9,
      corroborationCount: 3,
      contradictionPressure: 0.1,
      passAgreement: 0.9
    });

    expect(result.score).toBeGreaterThan(0.75);
    expect(result.band).toBe('high');
  });

  it('returns low band for weak signals', () => {
    const result = calibrateRelationConfidence({
      extractionConfidence: 0.2,
      sourceCredibility: 0.2,
      corroborationCount: 0,
      contradictionPressure: 0.9,
      passAgreement: 0.2
    });

    expect(result.score).toBeLessThan(0.5);
    expect(result.band).toBe('low');
  });
});
