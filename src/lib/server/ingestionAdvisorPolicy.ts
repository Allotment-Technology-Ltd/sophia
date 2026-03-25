/**
 * Layer A — deterministic guardrails for the ingestion AI advisor.
 * All model suggestions are clamped and validated before surfacing or auto-applying.
 */

import { z } from 'zod';

export type IngestionAdvisorMode = 'off' | 'shadow' | 'auto';

export type AdvisorAutoApplyField = 'preset' | 'validation';

export const PreScanAdvisorSchema = z.object({
  recommendedPreset: z.enum(['budget', 'balanced', 'complexity']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(2500),
  suggestCrossModelValidation: z.boolean(),
  efficiencyNotes: z.string().max(2000).optional(),
  riskSignals: z.array(z.string().max(500)).max(12).optional()
});

export type PreScanAdvisorOutput = z.infer<typeof PreScanAdvisorSchema>;

export interface HeuristicBaseline {
  recommendedPreset: 'budget' | 'balanced' | 'complexity';
  suggestCrossModelValidation: boolean;
  /** How baseline was derived (for UI) */
  basis: string;
}

export function getIngestionAdvisorMode(): IngestionAdvisorMode {
  const raw = (process.env.INGESTION_ADVISOR_MODE ?? 'off').trim().toLowerCase();
  if (raw === 'shadow' || raw === 'auto') return raw;
  return 'off';
}

export function getAdvisorAutoApplyFields(): Set<AdvisorAutoApplyField> {
  const raw = (process.env.INGESTION_ADVISOR_AUTO_APPLY ?? 'preset,validation').trim().toLowerCase();
  const set = new Set<AdvisorAutoApplyField>();
  for (const part of raw.split(',').map((s) => s.trim())) {
    if (part === 'preset') set.add('preset');
    if (part === 'validation') set.add('validation');
  }
  if (set.size === 0) {
    set.add('preset');
    set.add('validation');
  }
  return set;
}

/**
 * Token-based preset aligned with existing admin presets (budget / balanced / complexity).
 */
export function heuristicPresetFromPreScan(approxContentTokens: number): HeuristicBaseline {
  const t = Math.max(1, approxContentTokens);
  let recommendedPreset: HeuristicBaseline['recommendedPreset'];
  let basis: string;
  if (t < 18_000) {
    recommendedPreset = 'budget';
    basis = 'Token estimate under 18k → budget-style routing.';
  } else if (t < 90_000) {
    recommendedPreset = 'balanced';
    basis = 'Token estimate 18k–90k → balanced preset.';
  } else {
    recommendedPreset = 'complexity';
    basis = 'Large source (≥90k est. tokens) → complexity preset.';
  }
  const suggestCrossModelValidation = t >= 25_000 || recommendedPreset !== 'budget';
  return {
    recommendedPreset,
    suggestCrossModelValidation,
    basis
  };
}

export function clampAdvisorOutput(raw: unknown): PreScanAdvisorOutput {
  const parsed = PreScanAdvisorSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return PreScanAdvisorSchema.parse({
    recommendedPreset: 'balanced',
    confidence: 0.3,
    rationale: 'Advisor output failed validation; using safe defaults.',
    suggestCrossModelValidation: true,
    riskSignals: ['advisor_parse_fallback']
  });
}

export interface AdvisorApplyResult {
  appliedPreset: 'budget' | 'balanced' | 'complexity';
  appliedValidation: boolean;
  autoAppliedPreset: boolean;
  autoAppliedValidation: boolean;
  shadowDiff: {
    presetChangedVsHeuristic: boolean;
    presetChangedVsAdvisor: boolean;
    validationChangedVsHeuristic: boolean;
  };
}

/**
 * Layer A + Layer C: merge advisor suggestion with heuristics; auto-apply only allowlisted fields in `auto` mode.
 */
export function resolveAdvisorApply(
  mode: IngestionAdvisorMode,
  suggestion: PreScanAdvisorOutput | null,
  baseline: HeuristicBaseline,
  autoFields: Set<AdvisorAutoApplyField>
): AdvisorApplyResult {
  const adv = suggestion ?? {
    recommendedPreset: baseline.recommendedPreset,
    confidence: 0.5,
    rationale: baseline.basis,
    suggestCrossModelValidation: baseline.suggestCrossModelValidation
  };

  /** Shadow / off: execute heuristics only; advisor output is informational. */
  if (mode === 'off' || mode === 'shadow') {
    return {
      appliedPreset: baseline.recommendedPreset,
      appliedValidation: baseline.suggestCrossModelValidation,
      autoAppliedPreset: false,
      autoAppliedValidation: false,
      shadowDiff: {
        presetChangedVsHeuristic: adv.recommendedPreset !== baseline.recommendedPreset,
        presetChangedVsAdvisor: false,
        validationChangedVsHeuristic: adv.suggestCrossModelValidation !== baseline.suggestCrossModelValidation
      }
    };
  }

  let appliedPreset = baseline.recommendedPreset;
  let appliedValidation = baseline.suggestCrossModelValidation;
  let autoAppliedPreset = false;
  let autoAppliedValidation = false;

  if (autoFields.has('preset')) {
    appliedPreset = adv.recommendedPreset;
    autoAppliedPreset = true;
  }
  if (autoFields.has('validation')) {
    appliedValidation = adv.suggestCrossModelValidation;
    autoAppliedValidation = true;
  }

  const presetChangedVsHeuristic = appliedPreset !== baseline.recommendedPreset;
  const validationChangedVsHeuristic = appliedValidation !== baseline.suggestCrossModelValidation;
  const presetChangedVsAdvisor = suggestion != null && appliedPreset !== suggestion.recommendedPreset;

  return {
    appliedPreset,
    appliedValidation,
    autoAppliedPreset,
    autoAppliedValidation,
    shadowDiff: {
      presetChangedVsHeuristic,
      presetChangedVsAdvisor,
      validationChangedVsHeuristic
    }
  };
}
