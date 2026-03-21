import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { restormelSimulateRoute } from '$lib/server/restormel';
import { parseJsonBody, restormelJsonError } from '$lib/server/restormelAdmin';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const response = await restormelSimulateRoute(
      params.routeId,
      (body ?? {}) as Record<string, unknown>
    );
    return json({ simulation: response.data });
  } catch (error) {
    console.warn('[restormel] route simulate failed', {
      routeId: params.routeId,
      projectId: process.env.RESTORMEL_PROJECT_ID?.trim() || null
    }, error);
    return restormelJsonError(error);
  }
};

