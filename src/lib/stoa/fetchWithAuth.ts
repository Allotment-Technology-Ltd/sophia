import { getIdToken } from '$lib/authClient';

/**
 * Adds Neon bearer auth for browser-side STOA API calls.
 * API routes under /api/* are protected in hooks.server.ts.
 */
const logged401Keys = new Set<string>();

function toTelemetryUrl(input: string | URL | globalThis.Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function toTelemetryMethod(
  input: string | URL | globalThis.Request,
  init: RequestInit
): string {
  return (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function logStoaAuth401(params: {
  url: string;
  method: string;
  hasBearerToken: boolean;
  requestId: string | null;
}): void {
  const key = `${params.method} ${params.url} token:${params.hasBearerToken ? '1' : '0'}`;
  if (logged401Keys.has(key)) return;
  logged401Keys.add(key);

  const detail = {
    endpoint: params.url,
    method: params.method,
    hasBearerToken: params.hasBearerToken,
    requestId: params.requestId
  };

  console.warn('[STOA auth] 401 from API call', detail);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('stoa:auth-401', { detail }));
  }
}

export async function fetchWithAuth(input: string | URL | globalThis.Request, init: RequestInit = {}): Promise<Response> {
  const token = await getIdToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(input, {
    ...init,
    headers
  });

  const url = toTelemetryUrl(input);
  const endpoint = url.startsWith('http')
    ? (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })()
    : url;
  if (response.status === 401 && endpoint.startsWith('/api/stoa')) {
    logStoaAuth401({
      url: endpoint,
      method: toTelemetryMethod(input, init),
      hasBearerToken: Boolean(token),
      requestId: response.headers.get('x-request-id')
    });
  }

  return response;
}
