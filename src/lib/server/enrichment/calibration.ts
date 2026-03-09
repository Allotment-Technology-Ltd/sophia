export interface ConfidenceSignals {
  extractionConfidence: number;
  sourceCredibility: number;
  corroborationCount: number;
  contradictionPressure: number;
  passAgreement: number;
}

export interface CalibratedConfidence {
  score: number;
  band: 'high' | 'medium' | 'low';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function calibrateRelationConfidence(signals: ConfidenceSignals): CalibratedConfidence {
  const corroborationScore = clamp01(signals.corroborationCount / 3);
  const contradictionPenalty = clamp01(signals.contradictionPressure);

  const raw =
    0.34 * clamp01(signals.extractionConfidence) +
    0.24 * clamp01(signals.sourceCredibility) +
    0.16 * corroborationScore +
    0.16 * clamp01(signals.passAgreement) -
    0.1 * contradictionPenalty;

  const score = clamp01(raw);
  const band: 'high' | 'medium' | 'low' =
    score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low';

  return { score, band };
}
