import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { generateObject } from 'ai';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { resolveReasoningModelRoute } from '$lib/server/vertex';

const CleanupProposalSchema = z.object({
  title: z.string().min(1).max(120),
  priority: z.enum(['low', 'medium', 'high']),
  rationale: z.string().min(1).max(2000),
  operations: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('prune_superseded_failed_ingest_runs_neon'),
          limit: z.number().int().min(1).max(10_000),
          notes: z.string().max(1000).optional()
        })
      ])
    )
    .min(1)
    .max(5)
});

export const POST: RequestHandler = async ({ locals, request }) => {
  assertAdminAccess(locals);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const snapshot = body.snapshot;

  const route = await resolveReasoningModelRoute({
    depthMode: 'quick',
    pass: 'analysis',
    failureMode: 'degraded_default',
    restormelContext: { task: 'ingest_cleanup_proposal', estimatedInputTokens: 2500 }
  });

  const prompt = `You are an ops assistant for Sophia ingestion.

Given the current incident snapshot (counts, DLQ, promote backlog, job health, coverage gates), propose ONE safe destructive cleanup operation to reduce duplication/noise.

Constraints:
- Only propose operations that are safe and reversible by re-running ingestion.
- Never propose deleting the only successful data for a source.
- Prefer pruning superseded failed ingest_runs when a later done exists.
- Output only JSON matching the schema.

Snapshot:
${JSON.stringify(snapshot ?? {}, null, 2).slice(0, 20_000)}
`;

  try {
    const result = await generateObject({
      model: route.model,
      schema: CleanupProposalSchema,
      system:
        'Return only valid JSON for the cleanup proposal. Do not propose anything outside the allowed operation kinds.',
      prompt,
      temperature: 0.2,
      maxOutputTokens: 900
    });
    const proposal = CleanupProposalSchema.parse(result.object);
    return json({ ok: true, proposal, model: { provider: route.provider, modelId: route.modelId } });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Cleanup proposal failed.' },
      { status: 500 }
    );
  }
};

