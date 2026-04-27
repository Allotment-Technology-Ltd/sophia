import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getOperatorByokTargetUid } from '$lib/server/byok/operatorByokTarget';
import { getByokProviderApiKey } from '$lib/server/byok/store';
import { parseByokProvider } from '$lib/server/byok/types';
import {
  DEFAULT_AIZOLO_MODEL_PROBE_ID,
  probeAizoloModelWithApiKey
} from '$lib/server/byok/validation';
import { getEnabledByokProviders, isByokProviderEnabled } from '$lib/server/byok/config';
import { problemJson, resolveRequestId } from '$lib/server/problem';

export const POST: RequestHandler = async ({ locals, request, params }) => {
  assertAdminAccess(locals);
  const requestId = resolveRequestId(request);
  const targetUid = getOperatorByokTargetUid();
  if (!targetUid) {
    return problemJson({
      status: 503,
      title: 'Operator BYOK target not configured',
      detail: 'Set OWNER_UIDS to at least one Neon Auth user id (JWT sub).',
      requestId
    });
  }

  const provider = parseByokProvider(params.provider);
  const enabledProviders = getEnabledByokProviders();
  if (!provider) {
    return problemJson({
      status: 400,
      title: 'Invalid provider',
      detail: `provider must be one of: ${enabledProviders.join(', ')}`,
      requestId
    });
  }
  if (!isByokProviderEnabled(provider)) {
    return problemJson({
      status: 404,
      title: 'Not found',
      detail: `BYOK provider ${provider} is not enabled.`,
      requestId
    });
  }
  if (provider !== 'aizolo') {
    return problemJson({
      status: 400,
      title: 'Unsupported model probe',
      detail: 'Direct saved-key model probing is currently implemented for AiZolo only.',
      requestId
    });
  }

  const body = (await request.json().catch(() => ({}))) as { model_id?: string };
  const modelId = body.model_id?.trim() || DEFAULT_AIZOLO_MODEL_PROBE_ID;

  let apiKey: string | null;
  try {
    apiKey = await getByokProviderApiKey(targetUid, provider, {
      allowPending: true,
      allowInvalid: true
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return problemJson({
      status: 503,
      title: 'Unable to read stored operator BYOK credential',
      detail,
      requestId
    });
  }

  if (!apiKey) {
    return problemJson({
      status: 404,
      title: 'Not found',
      detail: `No configured ${provider} credential for operator target UID.`,
      requestId
    });
  }

  const probe = await probeAizoloModelWithApiKey(apiKey, modelId);
  return json({ targetUid, provider, probe }, { headers: { 'X-Request-Id': requestId } });
};
