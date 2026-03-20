import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { restormelGetRouteHistory } from '$lib/server/restormel';
import { restormelJsonError } from '$lib/server/restormelAdmin';

export const GET: RequestHandler = async ({ locals, params }) => {
  assertAdminAccess(locals);
  try {
    const response = await restormelGetRouteHistory(params.routeId);
    return json({ history: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};

