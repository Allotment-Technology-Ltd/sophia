/**
 * Layer B — AI advisor for ingestion (pre-scan and offline coach).
 * Outputs are schema-bound (Zod); Layer A policy clamps and controls auto-apply.
 */

import { generateObject } from 'ai';
import { resolveReasoningModelRoute } from '$lib/server/vertex';
import {
  clampAdvisorOutput,
  getAdvisorAutoApplyFields,
  getIngestionAdvisorMode,
  heuristicPresetFromPreScan,
  PreScanAdvisorSchema,
  resolveAdvisorApply,
  type AdvisorAutoApplyField,
  type HeuristicBaseline,
  type IngestionAdvisorMode,
  type PreScanAdvisorOutput
} from '$lib/server/ingestionAdvisorPolicy';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
import {
  clampCoachOutput,
  COACH_SCHEMA,
  type CoachAggregatedSignals,
  type IngestionCoachOutput
} from '$lib/ingestionCoachSchema';

const REPORTS_COLLECTION = 'ingestion_run_reports';

export type { CoachAggregatedSignals, IngestionCoachOutput } from '$lib/ingestionCoachSchema';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function mergeIssueSummaryInto(
  target: Record<string, number>,
  raw: unknown
): void {
  if (!isRecord(raw)) return;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      target[k] = (target[k] ?? 0) + Math.trunc(v);
    }
  }
}

function aggregateCoachSignalsFromReportDocs(
  docs: Array<{ data(): Record<string, unknown> | undefined }>
): CoachAggregatedSignals {
  const issueKindTotals: Record<string, number> = {};
  let totalIssues = 0;
  let sumRoutingDegradedCalls = 0;
  let sumRoutingFallbackUsed = 0;
  let runsWithTerminalError = 0;

  for (const doc of docs) {
    const d = doc.data() ?? {};
    const ic = typeof d.issueCount === 'number' && Number.isFinite(d.issueCount) ? Math.trunc(d.issueCount) : 0;
    totalIssues += Math.max(0, ic);
    mergeIssueSummaryInto(issueKindTotals, d.issueSummary);

    const rs = d.routingStats;
    if (isRecord(rs)) {
      const deg = rs.degradedRouteCount;
      const fb = rs.fallbackUsedCount;
      if (typeof deg === 'number' && Number.isFinite(deg)) sumRoutingDegradedCalls += Math.max(0, Math.trunc(deg));
      if (typeof fb === 'number' && Number.isFinite(fb)) sumRoutingFallbackUsed += Math.max(0, Math.trunc(fb));
    }
    const te = d.terminalError;
    if (typeof te === 'string' && te.trim() !== '') runsWithTerminalError += 1;
  }

  return {
    reportsInSample: docs.length,
    issueKindTotals,
    totalIssues,
    sumRoutingDegradedCalls,
    sumRoutingFallbackUsed,
    runsWithTerminalError
  };
}

function buildPreScanAdvisorPrompt(input: {
  sourceTitle: string;
  sourceType?: string;
  approxContentTokens: number;
  approxContentChars: number;
  phaseEstimatesJson: string;
  heuristic: HeuristicBaseline;
}): string {
  return `You are a systems planner for a philosophy corpus ingestion pipeline (fetch → extract claims → relations → grouping → optional validation → embeddings → store).

Given pre-scan metadata, confirm the fixed **production** pipeline profile and whether cross-model validation is worthwhile (the only operator-facing cost/quality lever besides per-stage models).

**Heuristic baseline (deterministic — you may agree or override validation only; preset is always production):**
- Pipeline profile: ${input.heuristic.recommendedPreset}
- Suggest cross-model validation: ${input.heuristic.suggestCrossModelValidation}
- Basis: ${input.heuristic.basis}

**Source**
- Title: ${input.sourceTitle}
- Type: ${input.sourceType ?? 'unknown'}
- Approx tokens: ${input.approxContentTokens}
- Approx chars: ${input.approxContentChars}

**Phase token estimates (JSON):**
${input.phaseEstimatesJson}

Respond with structured fields only. Set recommendedPreset to "production". Prefer cost-aware choices when quality risk is low; recommend validation when the source is long, dense, or likely to stress JSON/schema conformance.`;
}

const PRECAN_SYSTEM = `You output only the required JSON object. Be concise in rationale. Never suggest skipping validation solely to save cost when the source is large or structurally messy.`;

export interface PreScanAdvisorContext {
  sourceTitle: string;
  sourceType?: string;
  approxContentTokens: number;
  approxContentChars: number;
  phaseEstimates: unknown[];
}

export interface AdvisorApiEnvelope {
  mode: IngestionAdvisorMode;
  enabled: boolean;
  heuristicBaseline: HeuristicBaseline;
  suggestion: PreScanAdvisorOutput | null;
  applied: {
    preset: 'production';
    runValidate: boolean;
  };
  autoApplied: {
    preset: boolean;
    validation: boolean;
  };
  shadowDiff: {
    presetChangedVsHeuristic: boolean;
    presetChangedVsAdvisor: boolean;
    validationChangedVsHeuristic: boolean;
  };
  model?: { provider: string; modelId: string };
  error?: string;
}

export interface PreScanAdvisorRequestOptions {
  /** When set (e.g. from admin ingest UI), overrides `INGESTION_ADVISOR_MODE` for this pre-scan only. */
  mode?: IngestionAdvisorMode;
  /** When set, overrides `INGESTION_ADVISOR_AUTO_APPLY` for auto mode. */
  autoApplyFields?: Set<AdvisorAutoApplyField>;
}

export async function runPreScanAdvisorBlock(
  ctx: PreScanAdvisorContext,
  requestOptions?: PreScanAdvisorRequestOptions
): Promise<AdvisorApiEnvelope> {
  const mode = requestOptions?.mode ?? getIngestionAdvisorMode();
  const autoFieldsForMerge = requestOptions?.autoApplyFields ?? getAdvisorAutoApplyFields();
  const baseline = heuristicPresetFromPreScan(ctx.approxContentTokens);

  if (mode === 'off') {
    const apply = resolveAdvisorApply('off', null, baseline, new Set());
    return {
      mode: 'off',
      enabled: false,
      heuristicBaseline: baseline,
      suggestion: null,
      applied: { preset: apply.appliedPreset, runValidate: apply.appliedValidation },
      autoApplied: { preset: false, validation: false },
      shadowDiff: apply.shadowDiff
    };
  }

  try {
    const route = await resolveReasoningModelRoute({
      depthMode: 'quick',
      pass: 'analysis',
      failureMode: 'degraded_default',
      restormelContext: {
        task: 'ingestion_advisor_prescan',
        estimatedInputTokens: Math.min(32_000, Math.ceil(ctx.approxContentTokens / 4)),
        estimatedInputChars: ctx.approxContentChars
      }
    });

    const prompt = buildPreScanAdvisorPrompt({
      sourceTitle: ctx.sourceTitle,
      sourceType: ctx.sourceType,
      approxContentTokens: ctx.approxContentTokens,
      approxContentChars: ctx.approxContentChars,
      phaseEstimatesJson: JSON.stringify(ctx.phaseEstimates).slice(0, 24_000),
      heuristic: baseline
    });

    const result = await generateObject({
      model: route.model,
      schema: PreScanAdvisorSchema,
      system: PRECAN_SYSTEM,
      prompt,
      temperature: 0.25,
      maxOutputTokens: 1200
    });

    const suggestion = clampAdvisorOutput(result.object);
    const merged = resolveAdvisorApply(mode, suggestion, baseline, autoFieldsForMerge);

    return {
      mode,
      enabled: true,
      heuristicBaseline: baseline,
      suggestion,
      applied: {
        preset: merged.appliedPreset,
        runValidate: merged.appliedValidation
      },
      autoApplied: {
        preset: merged.autoAppliedPreset,
        validation: merged.autoAppliedValidation
      },
      shadowDiff: merged.shadowDiff,
      model: { provider: route.provider, modelId: route.modelId }
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[ingestionAdvisor] pre-scan advisor failed:', msg);
    const apply = resolveAdvisorApply(mode, null, baseline, new Set());
    return {
      mode,
      enabled: false,
      heuristicBaseline: baseline,
      suggestion: null,
      applied: { preset: apply.appliedPreset, runValidate: apply.appliedValidation },
      autoApplied: { preset: false, validation: false },
      shadowDiff: apply.shadowDiff,
      error: msg
    };
  }
}

export async function runIngestionCoach(limit: number): Promise<{
  ok: true;
  output: IngestionCoachOutput;
  reportsAnalyzed: number;
  aggregatedSignals: CoachAggregatedSignals | null;
  model?: { provider: string; modelId: string };
  error?: string;
}> {
  const cap = Math.min(100, Math.max(3, limit));
  let snap;
  try {
    snap = await sophiaDocumentsDb
      .collection(REPORTS_COLLECTION)
      .orderBy('completedAt', 'desc')
      .limit(cap)
      .get();
  } catch {
    return {
      ok: true,
      reportsAnalyzed: 0,
      aggregatedSignals: null,
      output: {
        executiveSummary: 'No ingestion run reports available (Firestore query failed or collection empty).',
        recommendations: ['Run a few ingestions in the admin UI to populate ingestion_run_reports.'],
        priority: 'low' as const
      }
    };
  }

  const aggregatedSignals =
    snap.docs.length > 0 ? aggregateCoachSignalsFromReportDocs(snap.docs) : null;

  const lines: string[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const summary = d.issueSummary && typeof d.issueSummary === 'object' ? JSON.stringify(d.issueSummary) : '{}';
    const routingStats =
      d.routingStats && typeof d.routingStats === 'object' ? JSON.stringify(d.routingStats) : '{}';
    const batchOverrides =
      d.batchOverrides && typeof d.batchOverrides === 'object' ? JSON.stringify(d.batchOverrides) : '{}';
    lines.push(
      `- run ${doc.id} status=${d.status} url=${d.sourceUrl ?? '?'} issues=${d.issueCount ?? 0} summary=${summary} routingStats=${routingStats} batchOverrides=${batchOverrides} err=${d.terminalError ?? 'none'}`
    );
  }

  if (snap.docs.length === 0) {
    return {
      ok: true,
      reportsAnalyzed: 0,
      aggregatedSignals: null,
      output: {
        executiveSummary: 'No completed ingestion reports yet.',
        recommendations: ['Run at least one ingestion with INGESTION_ADVISOR or issue capture enabled so reports are written to Firestore.'],
        priority: 'low' as const
      }
    };
  }

  const route = await resolveReasoningModelRoute({
    depthMode: 'standard',
    pass: 'analysis',
    failureMode: 'degraded_default',
    restormelContext: {
      task: 'ingestion_coach',
      estimatedInputTokens: 4000
    }
  });

  const aggJson = JSON.stringify(aggregatedSignals ?? {}, null, 0);

  const prompt = `You improve Sophia's philosophy ingestion pipeline (SvelteKit admin + scripts/ingest.ts + Vertex/Anthropic via Restormel Keys).

**Deterministic aggregates from the same Firestore sample (authoritative — do not invent different totals):**
${aggJson}

Below are recent Firestore run summaries (per-run detail). Each line includes issueSummary JSON: counts by **kind**. Use these definitions exactly — do not invent separate infrastructure (there is no standalone "routing service"):

- **routing_degraded**: Restormel resolve failed or returned no route; Sophia used **degraded_default** (built-in provider/model). Fix: published Restormel routes for workload=ingestion + stage, correct RESTORMEL_PROJECT_ID / RESTORMEL_ENVIRONMENT_ID / gateway key, or provider quotas.
- routingStats: derived from worker \`[ROUTE]\` log lines; includes \`routingSources\` counts (e.g. degraded_default) and \`fallbackUsedCount\` when \`order>=1\`.
- batchOverrides: optional per-run env knobs applied to \`scripts/ingest.ts\` (e.g. extraction max tokens per section, grouping/validation target tokens, embedding batch size).
- **json_repair**: Model output failed JSON/schema check; repair pass ran. Fix: extraction prompt, max_tokens, batch sizes, or model choice.
- **truncation**: max_tokens / output truncation (often triggers batch_split). Fix: smaller passage batches, higher output limits where safe, or split logic.
- **batch_split**: oversized batch split after truncation. Expected recovery path; many splits suggest batching/token limits need tuning.
- **retry**: transient model/API retry (e.g. 429). Fix: backoff, rate limits, different model or time of day.
- **parse_or_schema**: parse/validation failed before repair.
- **warning**: generic WARN lines from the worker.
- **fetch_retry**, **sync_retry**, **ingest_retry**: automatic retries on fetch, SurrealDB sync, or full ingest.
- **grouping_integrity**, **budget**, **resume_checkpoint**, **cancelled**, **other_signal**: as named.

Reports:
${lines.join('\n')}

Produce actionable recommendations for **Sophia operators**: Restormel Keys routes, env vars, ingest flags (--ingest-provider, --validate), batching in scripts/ingest.ts, Vertex quotas. Avoid generic advice about mystery microservices or Firestore document size unless issue kinds or terminalError clearly support it. Be specific and prioritized.

**Structured outputs (required):**
- **UI variables (\`settingTweaks\`):** For anything the operator can change **on the admin ingest pipeline page** without editing code — use scope \`ui_preset\`, \`ui_validation\`, or \`batch_override\`. Set \`uiVariableId\` to one of: pipeline_preset, cross_model_validation, batch_extractionMaxTokensPerSection, batch_groupingTargetTokens, batch_validationTargetTokens, batch_relationsTargetTokens, batch_embedBatchSize (must match the control). For \`repo_implementation\` scope, use only when the fix is **not** a single UI control (e.g. “publish new Restormel route” is repo/infrastructure, not a dropdown).
- **Code / engineering (\`codeChangeReports\`):** For each **distinct** need that requires **editing code**, prompts under version control, Restormel dashboard publish, or env/infra outside this page — add an entry with \`title\`, \`detail\`, optional \`suggestedArea\` (ingest_worker, prompts, restormel_routes, admin_ui, infra_env, other), and \`evidenceIssueKinds\`. Do not duplicate the same work as both a UI tweak and a code report unless one is “try UI first” and the other is “if that fails, change code”.
- Prefer \`batch_override\` when truncation, batch_split, json_repair, or grouping_integrity dominate; prefer preset/validation when routing_degraded or retry patterns dominate.`;

  try {
    const result = await generateObject({
      model: route.model,
      schema: COACH_SCHEMA,
      system:
        'You output only valid JSON matching the schema. Write for operators and engineers. settingTweaks (UI) and codeChangeReports (engineering) must reference evidenceIssueKinds that appear in the deterministic aggregates when possible. Set uiVariableId on UI tweaks.',
      prompt,
      temperature: 0.35,
      maxOutputTokens: 4500
    });

    return {
      ok: true,
      output: clampCoachOutput(COACH_SCHEMA.parse(result.object)),
      reportsAnalyzed: snap.docs.length,
      aggregatedSignals,
      model: { provider: route.provider, modelId: route.modelId }
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[ingestionAdvisor] coach failed:', msg);
    return {
      ok: true,
      reportsAnalyzed: snap.docs.length,
      aggregatedSignals,
      output: {
        executiveSummary: `Coach could not complete an AI pass (${msg}). Review recent runs manually in Firestore ingestion_run_reports.`,
        recommendations: ['Check Vertex / model routing credentials.', 'Retry after confirming Restormel routes and API quotas.'],
        priority: 'medium' as const
      },
      error: msg
    };
  }
}
