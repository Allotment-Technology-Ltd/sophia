import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getOperatorByokTargetUid } from '$lib/server/byok/operatorByokTarget';
import { parseByokProvider } from '$lib/server/byok/types';
import { getEnabledByokProviders, isByokProviderEnabled } from '$lib/server/byok/config';
import {
  getByokProviderApiKey,
  listByokProviderStatuses,
  setByokProviderValidationStatus
} from '$lib/server/byok/store';
import { validateProviderApiKey } from '$lib/server/byok/validation';
import { problemJson, resolveRequestId } from '$lib/server/problem';

export const POST: RequestHandler = async ({ locals, request, params }) => {
  assertAdminAccess(locals);
  const requestId = resolveRequestId(request);
  const targetUid = getOperatorByokTargetUid();
  if (!targetUid) {
    return problemJson({
      status: 503,
      title: 'Operator BYOK target not configured',
      detail: 'Set OWNER_UIDS to at least one Firebase UID.',
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

  let apiKey: string | null;
  try {
    apiKey = await getByokProviderApiKey(targetUid, provider, { allowPending: true, allowInvalid: true });
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

  let validation: { ok: boolean; error?: string };
  try {
    validation = await validateProviderApiKey(provider, apiKey);
  } catch (err) {
    validation = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  await setByokProviderValidationStatus(targetUid, provider, {
    success: validation.ok,
    errorMessage: validation.error ?? null
  });

  const providers = await listByokProviderStatuses(targetUid);
  const current = providers.find((item) => item.provider === provider);

  return json({ targetUid, provider: current, validation }, { headers: { 'X-Request-Id': requestId } });
};
