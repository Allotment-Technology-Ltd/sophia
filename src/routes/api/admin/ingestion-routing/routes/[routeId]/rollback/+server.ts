import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { restormelRollbackRoute } from '$lib/server/restormel';
import { parseJsonBody, restormelJsonError } from '$lib/server/restormelAdmin';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  assertAdminAccess(locals);

  let body: unknown = {};
  const contentLength = request.headers.get('content-length');
  if (contentLength && contentLength !== '0') {
    try {
      body = await parseJsonBody(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
    }
  }

  try {
    const response = await restormelRollbackRoute(
      params.routeId,
      (body ?? {}) as Record<string, unknown>
    );
    return json({ rollback: response.data });
  } catch (error) {
    return restormelJsonError(error);
  }
};

