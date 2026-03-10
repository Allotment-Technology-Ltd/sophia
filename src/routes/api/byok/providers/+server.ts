import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listByokProviderStatuses } from '$lib/server/byok/store';
import { problemJson, resolveRequestId } from '$lib/server/problem';

export const GET: RequestHandler = async ({ locals, request }) => {
  const requestId = resolveRequestId(request);
  const uid = locals.user?.uid;

  if (!uid) {
    return problemJson({
      status: 401,
      title: 'Authentication required',
      detail: 'Provide a valid Firebase bearer token.',
      requestId
    });
  }

  const providers = await listByokProviderStatuses(uid);
  return json(
    { providers },
    {
      headers: {
        'X-Request-Id': requestId
      }
    }
  );
};
