import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
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

  let apiKey: string | null;
  try {
    apiKey = await getByokProviderApiKey(uid, provider, { allowPending: true, allowInvalid: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[BYOK validate] decrypt/load failed:', detail);
    return problemJson({
      status: 503,
      title: 'Unable to read stored BYOK credential',
      detail: `${detail} — If this is a legacy Cloud KMS payload, run scripts/byok-reencrypt-kms-to-local.ts and retry.`,
      requestId
    });
  }

  if (!apiKey) {
    return problemJson({
      status: 404,
      title: 'Not found',
      detail: `No configured ${provider} BYOK credential found.`,
      requestId
    });
  }

  let validation: { ok: boolean; error?: string };
  try {
    validation = await validateProviderApiKey(provider, apiKey);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    validation = { ok: false, error: detail };
  }

  try {
    await setByokProviderValidationStatus(uid, provider, {
      success: validation.ok,
      errorMessage: validation.error ?? null
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return problemJson({
      status: 503,
      title: 'Unable to update validation status',
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
      title: 'Unable to list BYOK providers',
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
