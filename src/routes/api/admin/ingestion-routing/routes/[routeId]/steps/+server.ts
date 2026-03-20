import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { restormelListRouteSteps, restormelSaveRouteSteps } from '$lib/server/restormel';
import { parseJsonBody, restormelJsonError } from '$lib/server/restormelAdmin';

export const GET: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);
  try {
    const response = await restormelListRouteSteps(params.routeId);
    return json({ steps: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const response = await restormelSaveRouteSteps(
      params.routeId,
      (body ?? {}) as Record<string, unknown>
    );
    return json({ steps: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};

