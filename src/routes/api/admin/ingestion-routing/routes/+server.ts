import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { restormelListRoutes, restormelPostRoute } from '$lib/server/restormel';
import { parseJsonBody, restormelJsonError } from '$lib/server/restormelAdmin';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  try {
    const response = await restormelListRoutes();
    return json({ routes: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const { httpStatus, data } = await restormelPostRoute((body ?? {}) as Record<string, unknown>);
    return json({ route: data }, { status: httpStatus === 201 ? 201 : 200 });
  } catch (error) {
    return restormelJsonError(error);
  }
};

