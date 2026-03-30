/**
 * Shared coach schema/types for offline ingestion coach (server + admin UI).
 */
import { z } from 'zod';

/** Stable ids for admin-ingest controls the Apply button can map to. */
export const CoachUiVariableIdSchema = z.enum([
  'pipeline_preset',
  'cross_model_validation',
  'batch_extractionMaxTokensPerSection',
  'batch_groupingTargetTokens',
  'batch_validationTargetTokens',
  'batch_relationsTargetTokens',
  'batch_embedBatchSize'
]);

export type CoachUiVariableId = z.infer<typeof CoachUiVariableIdSchema>;

/** Monospace labels for the pipeline UI. */
export const COACH_UI_VARIABLE_LABELS: Record<CoachUiVariableId, string> = {
  pipeline_preset: 'Pipeline profile (production)',
  cross_model_validation: 'Run cross-model validation',
  batch_extractionMaxTokensPerSection: 'Advanced · extraction max tokens per section',
  batch_groupingTargetTokens: 'Advanced · grouping target tokens',
  batch_validationTargetTokens: 'Advanced · validation target tokens',
  batch_relationsTargetTokens: 'Advanced · relations batch target tokens',
  batch_embedBatchSize: 'Advanced · embedding batch size'
};

export const CoachSettingTweakSchema = z.object({
  scope: z.enum(['ui_preset', 'ui_validation', 'batch_override', 'repo_implementation']),
  /** Short human label for the admin pipeline (e.g. “Pipeline preset”, “Extraction max tokens / section”). */
  label: z.string().max(200),
  detail: z.string().max(2500),
  confidence: z.number().min(0).max(1),
  evidenceIssueKinds: z.array(z.string().max(64)).max(16).optional(),
  /** When scope is UI-tweakable, set this so the UI can show a consistent variable name. */
  uiVariableId: CoachUiVariableIdSchema.optional(),
  preset: z.union([z.literal('production'), z.enum(['budget', 'balanced', 'complexity'])]).optional(),
  runValidation: z.boolean().optional(),
  batchOverrideKey: z
    .enum([
      'extractionMaxTokensPerSection',
      'groupingTargetTokens',
      'validationTargetTokens',
      'relationsTargetTokens',
      'embedBatchSize'
    ])
    .optional(),
  batchOverrideValue: z.number().optional()
});

export type CoachSettingTweak = z.infer<typeof CoachSettingTweakSchema>;

/** Work that needs a repo change, infra change, or Restormel publish — not a single UI field. */
export const CodeChangeReportSchema = z.object({
  title: z.string().max(200),
  detail: z.string().max(2500),
  suggestedArea: z
    .enum(['ingest_worker', 'prompts', 'restormel_routes', 'admin_ui', 'infra_env', 'other'])
    .optional(),
  evidenceIssueKinds: z.array(z.string().max(64)).max(16).optional()
});

export type CodeChangeReport = z.infer<typeof CodeChangeReportSchema>;

export const CODE_CHANGE_AREA_LABELS: Record<
  NonNullable<CodeChangeReport['suggestedArea']>,
  string
> = {
  ingest_worker: 'Ingest worker / scripts',
  prompts: 'Prompts & schemas',
  restormel_routes: 'Restormel Keys routes / publish',
  admin_ui: 'Admin UI',
  infra_env: 'Infra / env / quotas',
  other: 'Other engineering'
};

export const COACH_SCHEMA = z.object({
  executiveSummary: z.string().max(3000),
  recommendations: z.array(z.string().max(1200)).min(1).max(12),
  priority: z.enum(['low', 'medium', 'high']),
  suggestedNextExperiments: z.array(z.string().max(800)).max(6).optional(),
  /** Controls that exist on the admin ingest pipeline page (preset, validation, advanced batch overrides). */
  settingTweaks: z.array(CoachSettingTweakSchema).max(12).optional(),
  /** Distinct engineering / code / infra follow-ups (prompt edits, worker logic, Restormel publish, env). */
  codeChangeReports: z.array(CodeChangeReportSchema).max(12).optional()
});

export type IngestionCoachOutput = z.infer<typeof COACH_SCHEMA>;

export interface CoachAggregatedSignals {
  reportsInSample: number;
  issueKindTotals: Record<string, number>;
  totalIssues: number;
  sumRoutingDegradedCalls: number;
  sumRoutingFallbackUsed: number;
  runsWithTerminalError: number;
}

/** Align UI / worker bounds for advanced batch overrides (`+page.svelte` + ingest run payload). */
export function clampCoachBatchOverrideValue(
  key: CoachSettingTweak['batchOverrideKey'],
  n: number
): number {
  if (!key) return n;
  const t = Math.trunc(n);
  switch (key) {
    case 'extractionMaxTokensPerSection':
      return Math.min(20_000, Math.max(1000, t));
    case 'groupingTargetTokens':
    case 'validationTargetTokens':
      return Math.min(400_000, Math.max(10_000, t));
    case 'relationsTargetTokens':
      return Math.min(250_000, Math.max(5000, t));
    case 'embedBatchSize':
      return Math.min(2000, Math.max(25, t));
    default:
      return t;
  }
}

const BATCH_KEY_TO_UI_ID: Record<
  NonNullable<CoachSettingTweak['batchOverrideKey']>,
  CoachUiVariableId
> = {
  extractionMaxTokensPerSection: 'batch_extractionMaxTokensPerSection',
  groupingTargetTokens: 'batch_groupingTargetTokens',
  validationTargetTokens: 'batch_validationTargetTokens',
  relationsTargetTokens: 'batch_relationsTargetTokens',
  embedBatchSize: 'batch_embedBatchSize'
};

function inferUiVariableId(tw: CoachSettingTweak): CoachUiVariableId | undefined {
  if (tw.uiVariableId) return tw.uiVariableId;
  if (tw.scope === 'ui_preset') return 'pipeline_preset';
  if (tw.scope === 'ui_validation') return 'cross_model_validation';
  if (tw.scope === 'batch_override' && tw.batchOverrideKey)
    return BATCH_KEY_TO_UI_ID[tw.batchOverrideKey];
  return undefined;
}

export function clampCoachOutput(raw: IngestionCoachOutput): IngestionCoachOutput {
  const tweaks = raw.settingTweaks?.map((tw) => {
    const withClamp =
      tw.scope === 'batch_override' && tw.batchOverrideKey && tw.batchOverrideValue != null
        ? {
            ...tw,
            batchOverrideValue: clampCoachBatchOverrideValue(tw.batchOverrideKey, tw.batchOverrideValue)
          }
        : tw;
    const uiVariableId = inferUiVariableId(withClamp);
    return uiVariableId ? { ...withClamp, uiVariableId } : withClamp;
  });
  return { ...raw, settingTweaks: tweaks };
}
