import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { restormelResolve } from '$lib/server/restormel';
import { parseJsonBody, restormelJsonError } from '$lib/server/restormelAdmin';

export const POST: RequestHandler = async ({ locals, request }) => {
  assertAdminAccess(locals);

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const response = await restormelResolve((body ?? {}) as Parameters<typeof restormelResolve>[0]);
    return json({ resolve: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};
