import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { getOperatorByokTargetUid } from '$lib/server/byok/operatorByokTarget';
import { parseByokProvider } from '$lib/server/byok/types';
import { getEnabledByokProviders, isByokProviderEnabled } from '$lib/server/byok/config';
import {
  listByokProviderStatuses,
  revokeByokProviderCredential,
  setByokProviderValidationStatus,
  upsertByokProviderCredential
} from '$lib/server/byok/store';
import { validateProviderApiKey } from '$lib/server/byok/validation';
import { problemJson, resolveRequestId } from '$lib/server/problem';

export const PUT: RequestHandler = async ({ locals, request, params }) => {
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
      detail: `BYOK provider ${provider} is not enabled in this environment.`,
      requestId
    });
  }

  const body = (await request.json().catch(() => ({}))) as { api_key?: string };
  const apiKey = body.api_key?.trim();
  if (!apiKey) {
    return problemJson({
      status: 400,
      title: 'Invalid request',
      detail: 'api_key is required.',
      requestId
    });
  }

  try {
    await upsertByokProviderCredential(targetUid, provider, apiKey);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return problemJson({
      status: 503,
      title: 'Unable to save operator BYOK credential',
      detail,
      requestId
    });
  }

  let validation: { ok: boolean; error?: string };
  try {
    validation = await validateProviderApiKey(provider, apiKey);
  } catch (err) {
    validation = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    await setByokProviderValidationStatus(targetUid, provider, {
      success: validation.ok,
      errorMessage: validation.error ?? null
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return problemJson({
      status: 503,
      title: 'Credential saved but status update failed',
      detail,
      requestId
    });
  }

  const providers = await listByokProviderStatuses(targetUid);
  const current = providers.find((item) => item.provider === provider);

  return json({ targetUid, provider: current, validation }, { headers: { 'X-Request-Id': requestId } });
};

export const DELETE: RequestHandler = async ({ locals, request, params }) => {
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

  await revokeByokProviderCredential(targetUid, provider);
  const providers = await listByokProviderStatuses(targetUid);
  const current = providers.find((item) => item.provider === provider);

  return json({ targetUid, provider: current, ok: true }, { headers: { 'X-Request-Id': requestId } });
};
