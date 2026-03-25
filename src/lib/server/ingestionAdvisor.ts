/**
 * Layer B — AI advisor for ingestion (pre-scan and offline coach).
 * Outputs are schema-bound (Zod); Layer A policy clamps and controls auto-apply.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveReasoningModelRoute } from '$lib/server/vertex';
import {
  clampAdvisorOutput,
  getAdvisorAutoApplyFields,
  getIngestionAdvisorMode,
  heuristicPresetFromPreScan,
  PreScanAdvisorSchema,
  resolveAdvisorApply,
  type HeuristicBaseline,
  type IngestionAdvisorMode,
  type PreScanAdvisorOutput
} from '$lib/server/ingestionAdvisorPolicy';
import { adminDb } from '$lib/server/firebase-admin';

const REPORTS_COLLECTION = 'ingestion_run_reports';

const COACH_SCHEMA = z.object({
  executiveSummary: z.string().max(3000),
  recommendations: z.array(z.string().max(1200)).min(1).max(12),
  priority: z.enum(['low', 'medium', 'high']),
  suggestedNextExperiments: z.array(z.string().max(800)).max(6).optional()
});

export type IngestionCoachOutput = z.infer<typeof COACH_SCHEMA>;

function buildPreScanAdvisorPrompt(input: {
  sourceTitle: string;
  sourceType?: string;
  approxContentTokens: number;
  approxContentChars: number;
  phaseEstimatesJson: string;
  heuristic: HeuristicBaseline;
}): string {
  return `You are a systems planner for a philosophy corpus ingestion pipeline (fetch → extract claims → relations → grouping → optional validation → embeddings → store).

Given pre-scan metadata, recommend ONE pipeline preset for the operator UI and whether cross-model validation is worthwhile.

**Heuristic baseline (deterministic — you may agree or override with clear reason):**
- Recommended preset: ${input.heuristic.recommendedPreset}
- Suggest cross-model validation: ${input.heuristic.suggestCrossModelValidation}
- Basis: ${input.heuristic.basis}

**Source**
- Title: ${input.sourceTitle}
- Type: ${input.sourceType ?? 'unknown'}
- Approx tokens: ${input.approxContentTokens}
- Approx chars: ${input.approxContentChars}

**Phase token estimates (JSON):**
${input.phaseEstimatesJson}

Respond with structured fields only. Prefer cost-aware choices when quality risk is low; prefer stronger presets when the source is long, dense, or likely to stress JSON/schema conformance.`;
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
    preset: 'budget' | 'balanced' | 'complexity';
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

export async function runPreScanAdvisorBlock(
  ctx: PreScanAdvisorContext
): Promise<AdvisorApiEnvelope> {
  const mode = getIngestionAdvisorMode();
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
    const autoFields = getAdvisorAutoApplyFields();
    const merged = resolveAdvisorApply(mode, suggestion, baseline, autoFields);

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
  model?: { provider: string; modelId: string };
  error?: string;
}> {
  const cap = Math.min(100, Math.max(3, limit));
  let snap;
  try {
    snap = await adminDb
      .collection(REPORTS_COLLECTION)
      .orderBy('completedAt', 'desc')
      .limit(cap)
      .get();
  } catch {
    return {
      ok: true,
      reportsAnalyzed: 0,
      output: {
        executiveSummary: 'No ingestion run reports available (Firestore query failed or collection empty).',
        recommendations: ['Run a few ingestions in the admin UI to populate ingestion_run_reports.'],
        priority: 'low' as const
      }
    };
  }

  const lines: string[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const summary = d.issueSummary && typeof d.issueSummary === 'object' ? JSON.stringify(d.issueSummary) : '{}';
    lines.push(
      `- run ${doc.id} status=${d.status} url=${d.sourceUrl ?? '?'} issues=${d.issueCount ?? 0} summary=${summary} err=${d.terminalError ?? 'none'}`
    );
  }

  if (snap.docs.length === 0) {
    return {
      ok: true,
      reportsAnalyzed: 0,
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

  const prompt = `You improve Sophia's philosophy ingestion pipeline (SvelteKit admin + scripts/ingest.ts + Vertex/Anthropic via Restormel Keys).

Below are recent Firestore run summaries. Each line includes issueSummary JSON: counts by **kind**. Use these definitions exactly — do not invent separate infrastructure (there is no standalone "routing service"):

- **routing_degraded**: Restormel resolve failed or returned no route; Sophia used **degraded_default** (built-in provider/model). Fix: published Restormel routes for workload=ingestion + stage, correct RESTORMEL_PROJECT_ID / RESTORMEL_ENVIRONMENT_ID / gateway key, or provider quotas.
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

Produce actionable recommendations for **Sophia operators**: Restormel Keys routes, env vars, ingest flags (--ingest-provider, --validate), batching in scripts/ingest.ts, Vertex quotas. Avoid generic advice about mystery microservices or Firestore document size unless issue kinds or terminalError clearly support it. Be specific and prioritized.`;

  try {
    const result = await generateObject({
      model: route.model,
      schema: COACH_SCHEMA,
      system: 'You output only valid JSON matching the schema. Write for operators and engineers.',
      prompt,
      temperature: 0.35,
      maxOutputTokens: 2500
    });

    return {
      ok: true,
      output: COACH_SCHEMA.parse(result.object),
      reportsAnalyzed: snap.docs.length,
      model: { provider: route.provider, modelId: route.modelId }
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[ingestionAdvisor] coach failed:', msg);
    return {
      ok: true,
      reportsAnalyzed: snap.docs.length,
      output: {
        executiveSummary: `Coach could not complete an AI pass (${msg}). Review recent runs manually in Firestore ingestion_run_reports.`,
        recommendations: ['Check Vertex / model routing credentials.', 'Retry after confirming Restormel routes and API quotas.'],
        priority: 'medium' as const
      },
      error: msg
    };
  }
}
