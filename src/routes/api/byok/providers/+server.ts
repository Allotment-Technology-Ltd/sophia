import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { emptyNotConfiguredByokStatuses, listByokProviderStatuses } from '$lib/server/byok/store';
import { problemJson, resolveRequestId } from '$lib/server/problem';

function shouldFallbackEmptyByokList(): boolean {
  const raw = (process.env.BYOK_PROVIDERS_FALLBACK_EMPTY ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export const GET: RequestHandler = async ({ locals, request }) => {
  const requestId = resolveRequestId(request);
  const uid = locals.user?.uid;

  if (!uid) {
    return problemJson({
      status: 401,
      title: 'Authentication required',
      detail: 'Provide a valid Neon Auth JWT (Authorization: Bearer …).',
      requestId
    });
  }

  try {
    const providers = await listByokProviderStatuses(uid);
    return json(
      { providers },
      {
        headers: {
          'X-Request-Id': requestId
        }
      }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (dev || shouldFallbackEmptyByokList()) {
      console.warn('[byok/providers] store read failed; returning empty BYOK statuses', detail);
      return json(
        {
          providers: emptyNotConfiguredByokStatuses(),
          degraded: true,
          detail:
            'BYOK data could not be loaded (Firestore / credentials). Keys show as not configured until the store is available.'
        },
        {
          headers: {
            'X-Request-Id': requestId
          }
        }
      );
    }
    return problemJson({
      status: 503,
      title: 'BYOK status temporarily unavailable',
      detail,
      requestId
    });
  }
};
