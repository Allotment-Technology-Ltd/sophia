import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BYOK_PROVIDERS, parseByokProvider } from '$lib/server/byok/types';
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
  if (!provider) {
    return problemJson({
      status: 400,
      title: 'Invalid provider',
      detail: `provider must be one of: ${BYOK_PROVIDERS.join(', ')}`,
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

  await upsertByokProviderCredential(uid, provider, apiKey);
  const validation = await validateProviderApiKey(provider, apiKey);
  await setByokProviderValidationStatus(uid, provider, {
    success: validation.ok,
    errorMessage: validation.error ?? null
  });

  const providers = await listByokProviderStatuses(uid);
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
  if (!provider) {
    return problemJson({
      status: 400,
      title: 'Invalid provider',
      detail: `provider must be one of: ${BYOK_PROVIDERS.join(', ')}`,
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
