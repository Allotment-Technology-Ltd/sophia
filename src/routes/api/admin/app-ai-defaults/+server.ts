import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
  getAppAiDefaultsAdminSummary,
  upsertAppAiDefaults
} from '$lib/server/appAiDefaults';
import { parseJsonBody } from '$lib/server/restormelAdmin';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  try {
    const summary = await getAppAiDefaultsAdminSummary();
    return json({ summary });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  const actor = assertAdminAccess(locals);
  if (!process.env.DATABASE_URL?.trim()) {
    return json(
      { error: 'DATABASE_URL is not configured; app-wide defaults require Neon.' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  const rec = body as Record<string, unknown>;
  try {
    await upsertAppAiDefaults({
      defaultRestormelSharedRouteId:
        typeof rec.defaultRestormelSharedRouteId === 'string' || rec.defaultRestormelSharedRouteId === null
          ? (rec.defaultRestormelSharedRouteId as string | null)
          : undefined,
      degradedPrimaryProvider:
        typeof rec.degradedPrimaryProvider === 'string' || rec.degradedPrimaryProvider === null
          ? (rec.degradedPrimaryProvider as string | null)
          : undefined,
      degradedReasoningModelStandard:
        typeof rec.degradedReasoningModelStandard === 'string' || rec.degradedReasoningModelStandard === null
          ? (rec.degradedReasoningModelStandard as string | null)
          : undefined,
      degradedReasoningModelDeep:
        typeof rec.degradedReasoningModelDeep === 'string' || rec.degradedReasoningModelDeep === null
          ? (rec.degradedReasoningModelDeep as string | null)
          : undefined,
      degradedExtractionModel:
        typeof rec.degradedExtractionModel === 'string' || rec.degradedExtractionModel === null
          ? (rec.degradedExtractionModel as string | null)
          : undefined,
      defaultOpenaiApiKey: typeof rec.defaultOpenaiApiKey === 'string' ? rec.defaultOpenaiApiKey : undefined,
      clearDefaultOpenaiApiKey: rec.clearDefaultOpenaiApiKey === true,
      updatedByUid: actor.uid
    });
    const summary = await getAppAiDefaultsAdminSummary();
    return json({ ok: true, summary });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
