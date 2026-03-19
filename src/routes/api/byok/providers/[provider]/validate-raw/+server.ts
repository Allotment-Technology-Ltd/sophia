import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseByokProvider } from '$lib/server/byok/types';
import { getEnabledByokProviders, isByokProviderEnabled } from '$lib/server/byok/config';
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

  const validation = await validateProviderApiKey(provider, apiKey);

  return json(
    {
      provider,
      validation
    },
    {
      headers: {
        'X-Request-Id': requestId
      }
    }
  );
};
