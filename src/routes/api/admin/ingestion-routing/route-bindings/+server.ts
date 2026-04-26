import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { parseJsonBody } from '$lib/server/restormelAdmin';
import {
  getStoredIngestionRouteBindings,
  sanitizeBindingsPayload,
  upsertIngestionRouteBindings,
  type IngestionRouteBindingsPayload
} from '$lib/server/ingestionRouteBindings';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  try {
    const bindings = await getStoredIngestionRouteBindings();
    return json({
      databaseAvailable: Boolean(process.env.DATABASE_URL?.trim()),
      bindings
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  const actor = assertAdminAccess(locals);
  if (!process.env.DATABASE_URL?.trim()) {
    return json(
      {
        error:
          'DATABASE_URL is not configured; per-phase route bindings are stored in Neon.'
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  const patch = sanitizeBindingsPayload(body as IngestionRouteBindingsPayload);
  try {
    const bindings = await upsertIngestionRouteBindings(patch, actor.uid);
    return json({ ok: true, bindings });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};
