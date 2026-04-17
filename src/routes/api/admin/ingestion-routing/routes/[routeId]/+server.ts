import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
  restormelDeleteProjectRoute,
  restormelGetProjectRoute,
  restormelPatchProjectRoute
} from '$lib/server/restormel';
import { parseJsonBody, restormelJsonError } from '$lib/server/restormelAdmin';

/** Proxies Keys `GET …/projects/{projectId}/routes/{routeId}` (single route metadata). */
export const GET: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);
  try {
    const response = await restormelGetProjectRoute(params.routeId);
    return json({ route: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};

/** Proxies Keys `PATCH …/routes/{routeId}` (name, workload, stage, enabled, …). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const response = await restormelPatchProjectRoute(
      params.routeId,
      (body ?? {}) as Record<string, unknown>
    );
    return json({ route: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};

/** Proxies Keys `DELETE …/routes/{routeId}`. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);
  try {
    const response = await restormelDeleteProjectRoute(params.routeId);
    return json(response);
  } catch (error) {
    return restormelJsonError(error);
  }
};
