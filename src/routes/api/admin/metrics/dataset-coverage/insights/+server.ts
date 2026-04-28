import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { generateObject } from 'ai';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { resolveReasoningModelRoute } from '$lib/server/vertex';
import { fetchDatasetTopicPresetCoverage } from '$lib/server/metrics/datasetTopicPresetCoverage';

const CoverageGateInsightsSchema = z.object({
  summary: z.string().min(1).max(2500),
  gates: z
    .array(
      z.object({
        gate: z.string().min(1).max(120),
        status: z.enum(['pass', 'fail', 'unknown']),
        evidence: z.string().min(1).max(1200),
        next_actions: z.array(z.string().min(1).max(180)).min(1).max(6),
        deep_links: z.array(z.string().min(1).max(240)).max(6).optional()
      })
    )
    .min(1)
    .max(8)
});

export const POST: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);

  const route = await resolveReasoningModelRoute({
    depthMode: 'quick',
    pass: 'analysis',
    failureMode: 'degraded_default',
    restormelContext: { task: 'dataset_coverage_gate_insights', estimatedInputTokens: 3000 }
  });

  const coverage = await fetchDatasetTopicPresetCoverage();
  const prompt = `You are an ops assistant for Sophia ingestion.

Your job: summarize dataset coverage *gates* and the fastest operator actions to unblock them.

Rules:
- Focus on readiness gates and actionable next steps.
- Prefer linking to Monitoring panels via:
  - /admin/ingest/operator/activity?panel=coverage
  - /admin/ingest/operator/activity?panel=issues
  - /admin/ingest/operator/activity?panel=dlq
  - /admin/ingest/operator/activity?panel=promote
- Keep it short and operator-oriented.
- Output only valid JSON matching the schema.

Dataset coverage payload:
${JSON.stringify(coverage, null, 2).slice(0, 50_000)}
`;

  try {
    const result = await generateObject({
      model: route.model,
      schema: CoverageGateInsightsSchema,
      system: 'Return only valid JSON for the gate insights. No markdown.',
      prompt,
      temperature: 0.2,
      maxOutputTokens: 900
    });
    const insights = CoverageGateInsightsSchema.parse(result.object);
    return json({ ok: true, insights, model: { provider: route.provider, modelId: route.modelId } });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'Insights failed.' }, { status: 500 });
  }
};

