import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
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
    await upsertByokProviderCredential(uid, provider, apiKey);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[BYOK PUT] upsert failed:', detail);
    return problemJson({
      status: 503,
      title: 'Unable to save BYOK credential',
      detail: `${detail} — Check Firestore access (GOOGLE_APPLICATION_CREDENTIALS / secrets/*.json via pnpm dev) and that rules allow writes to users/{uid}/byokProviders.`,
      requestId
    });
  }

  let validation: { ok: boolean; error?: string };
  try {
    validation = await validateProviderApiKey(provider, apiKey);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[BYOK PUT] validate failed:', detail);
    validation = { ok: false, error: detail };
  }

  try {
    await setByokProviderValidationStatus(uid, provider, {
      success: validation.ok,
      errorMessage: validation.error ?? null
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[BYOK PUT] set validation status failed:', detail);
    return problemJson({
      status: 503,
      title: 'Credential saved but status update failed',
      detail,
      requestId
    });
  }

  let providers: Awaited<ReturnType<typeof listByokProviderStatuses>>;
  try {
    providers = await listByokProviderStatuses(uid);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return problemJson({
      status: 503,
      title: 'Unable to list BYOK providers after save',
      detail,
      requestId
    });
  }
  const current = providers.find((item) => item.provider === provider);

  return json(
    {
      provider: current,
      validation
    },
    {
      headers: {
        'X-Request-Id': requestId
      }
    }
  );
};

export const DELETE: RequestHandler = async ({ locals, request, params }) => {
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

  await revokeByokProviderCredential(uid, provider);
  const providers = await listByokProviderStatuses(uid);
  const current = providers.find((item) => item.provider === provider);

  return json(
    {
      provider: current,
      ok: true
    },
    {
      headers: {
        'X-Request-Id': requestId
      }
    }
  );
};
