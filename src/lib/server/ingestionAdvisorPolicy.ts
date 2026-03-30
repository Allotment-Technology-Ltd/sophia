/**
 * Layer A — deterministic guardrails for the ingestion AI advisor.
 * All model suggestions are clamped and validated before surfacing or auto-applying.
 */

import { z } from 'zod';

export type IngestionAdvisorMode = 'off' | 'shadow' | 'auto';

export type AdvisorAutoApplyField = 'preset' | 'validation';

export type IngestionPipelinePresetAdvisor = 'production';

const LEGACY_PRESETS = z.enum(['budget', 'balanced', 'complexity']);

export const PreScanAdvisorSchema = z.object({
  recommendedPreset: z
    .union([z.literal('production'), LEGACY_PRESETS])
    .transform((): IngestionPipelinePresetAdvisor => 'production'),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(2500),
  suggestCrossModelValidation: z.boolean(),
  efficiencyNotes: z.string().max(2000).optional(),
  riskSignals: z.array(z.string().max(500)).max(12).optional()
});

export type PreScanAdvisorOutput = z.infer<typeof PreScanAdvisorSchema>;

export interface HeuristicBaseline {
  recommendedPreset: IngestionPipelinePresetAdvisor;
  suggestCrossModelValidation: boolean;
  /** How baseline was derived (for UI) */
  basis: string;
}

export function getIngestionAdvisorMode(): IngestionAdvisorMode {
  const raw = (process.env.INGESTION_ADVISOR_MODE ?? 'off').trim().toLowerCase();
  if (raw === 'shadow' || raw === 'auto') return raw;
  return 'off';
}

/** Optional override from admin ingest UI (takes precedence over env). */
export function parseIngestionAdvisorModeFromRequest(value: unknown): IngestionAdvisorMode | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'off' || v === 'shadow' || v === 'auto') return v;
  return undefined;
}

export function getAdvisorAutoApplyFields(): Set<AdvisorAutoApplyField> {
  const raw = (process.env.INGESTION_ADVISOR_AUTO_APPLY ?? 'preset,validation').trim().toLowerCase();
  return parseAdvisorAutoApplyList(raw);
}

function parseAdvisorAutoApplyList(raw: string): Set<AdvisorAutoApplyField> {
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

/** Optional overrides from admin ingest UI (checkboxes). */
export function parseAdvisorAutoApplyFromRequest(body: unknown): Set<AdvisorAutoApplyField> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  const ap = o.ingestionAdvisorAutoApply;
  if (ap === undefined) return undefined;
  if (!ap || typeof ap !== 'object') return undefined;
  const p = ap as Record<string, unknown>;
  if (!('preset' in p) && !('validation' in p)) return undefined;
  const set = new Set<AdvisorAutoApplyField>();
  if (p.preset === true) set.add('preset');
  if (p.validation === true) set.add('validation');
  return set;
}

/**
 * Single production pipeline; token scale only steers validation default (cost vs coverage).
 */
export function heuristicPresetFromPreScan(approxContentTokens: number): HeuristicBaseline {
  const t = Math.max(1, approxContentTokens);
  const basis =
    t < 18_000
      ? 'Smaller source (<18k est. tokens) — production pipeline; cross-model validation optional by default.'
      : t < 90_000
        ? 'Medium source (18k–90k est. tokens) — production pipeline with validation recommended.'
        : 'Large source (≥90k est. tokens) — production pipeline; validation strongly recommended.';
  const suggestCrossModelValidation = t >= 18_000;
  return {
    recommendedPreset: 'production',
    suggestCrossModelValidation,
    basis
  };
}

export function clampAdvisorOutput(raw: unknown): PreScanAdvisorOutput {
  const parsed = PreScanAdvisorSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return PreScanAdvisorSchema.parse({
    recommendedPreset: 'production',
    confidence: 0.3,
    rationale: 'Advisor output failed validation; using safe defaults.',
    suggestCrossModelValidation: true,
    riskSignals: ['advisor_parse_fallback']
  });
}

export interface AdvisorApplyResult {
  appliedPreset: IngestionPipelinePresetAdvisor;
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
