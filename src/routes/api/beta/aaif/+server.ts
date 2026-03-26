import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AAIFRequestSchema } from '@restormel/aaif';
import { verifyApiKey } from '$lib/server/apiAuth';
import { logServerAnalytics } from '$lib/server/analytics';
import { mergeOwnerEnvFallbackIfEmpty } from '$lib/server/byok/effectiveKeys';
import { loadByokProviderApiKeys } from '$lib/server/byok/store';
import type { ProviderApiKeys } from '$lib/server/byok/types';
import { resolveByokOwnerUid } from '$lib/server/byok/tenantIdentity';
import { executeAAIFRequest } from '$lib/server/aaif/runtime';
import { problemJson, resolveRequestId } from '$lib/server/problem';

export const POST: RequestHandler = async ({ request }) => {
  const requestId = resolveRequestId(request);
  const startedAt = Date.now();

  const auth = await verifyApiKey(request);
  if (!auth.valid) {
    const status = auth.error === 'rate_limited' ? 429 : 401;
    return problemJson({
      status,
      title: status === 429 ? 'Rate limit exceeded' : 'Authentication failed',
      detail: `API key ${auth.error ?? 'invalid_api_key'}.`,
      type: `https://docs.usesophia.app/problems/${auth.error ?? 'invalid_api_key'}`,
      requestId,
      headers: {
        'X-Request-Id': requestId,
        'X-Processing-Time-Ms': String(Date.now() - startedAt),
        ...(status === 429 ? { 'Retry-After': '86400' } : {})
      }
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return problemJson({
      status: 400,
      title: 'Invalid request',
      detail: error instanceof Error ? error.message : 'Request body must be valid JSON.',
      type: 'https://docs.usesophia.app/problems/invalid-request',
      requestId,
      headers: {
        'X-Request-Id': requestId,
        'X-Processing-Time-Ms': String(Date.now() - startedAt)
      }
    });
  }

  const parsed = AAIFRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return problemJson({
      status: 400,
      title: 'Invalid request',
      detail: parsed.error.message,
      type: 'https://docs.usesophia.app/problems/invalid-request',
      requestId,
      headers: {
        'X-Request-Id': requestId,
        'X-Processing-Time-Ms': String(Date.now() - startedAt)
      }
    });
  }

  const tenantIdentity = resolveByokOwnerUid(request, auth.owner_uid);
  let providerApiKeys: ProviderApiKeys = {};
  if (tenantIdentity.ownerUid) {
    try {
      providerApiKeys = await loadByokProviderApiKeys(tenantIdentity.ownerUid);
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[BYOK] Unable to load provider keys for AAIF request:', error instanceof Error ? error.message : String(error));
      }
    }
  }
  providerApiKeys = await mergeOwnerEnvFallbackIfEmpty(providerApiKeys, 'beta aaif');

  try {
    const response = await executeAAIFRequest(parsed.data, {
      providerApiKeys,
      routeId: process.env.RESTORMEL_ANALYSE_ROUTE_ID?.trim() || undefined,
      failureMode: 'error'
    });

    await logServerAnalytics({
      event: 'developer_playground_request_success',
      request_id: requestId,
      key_id: auth.key_id,
      route: '/api/beta/aaif',
      success: true,
      status: 200,
      mode: 'json',
      latency_ms: Date.now() - startedAt,
      task: parsed.data.task ?? 'chat'
    });

    return json(response, {
      headers: {
        'X-Request-Id': requestId,
        'X-Processing-Time-Ms': String(Date.now() - startedAt)
      }
    });
  } catch (error) {
    await logServerAnalytics({
      event: 'developer_playground_request_error',
      request_id: requestId,
      key_id: auth.key_id,
      route: '/api/beta/aaif',
      success: false,
      status: 500,
      mode: 'json',
      latency_ms: Date.now() - startedAt,
      error_code: 'aaif_execution_failed'
    });

    return problemJson({
      status: 500,
      title: 'AAIF execution failed',
      detail: error instanceof Error ? error.message : String(error),
      type: 'https://docs.usesophia.app/problems/internal-error',
      requestId,
      headers: {
        'X-Request-Id': requestId,
        'X-Processing-Time-Ms': String(Date.now() - startedAt)
      }
    });
  }
};
