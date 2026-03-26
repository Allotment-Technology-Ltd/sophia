import { json } from '@sveltejs/kit';
import { RestormelDashboardError, RestormelResolveError } from './restormel';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function serializeRestormelError(error: unknown): {
  status: number;
  code: string;
  detail: string;
  endpoint?: string;
  userMessage?: string;
  publishErrors?: unknown[];
  /** Present when Keys returns `error: route_step_provider_not_allowed` with `allowed` array. */
  routeStepAllowedProviders?: string[];
} {
  if (error instanceof RestormelResolveError) {
    return {
      status: error.status,
      code: error.code,
      detail: error.detail,
      endpoint: error.endpoint,
      userMessage: error.userMessage
    };
  }

  if (error instanceof RestormelDashboardError) {
    const base = {
      status: error.status,
      code: error.code,
      detail: error.detail,
      endpoint: error.endpoint
    };
    if (isRecord(error.payload)) {
      let um =
        typeof error.payload.userMessage === 'string' ? error.payload.userMessage.trim() : '';
      if (!um && error.status === 409) {
        um = error.detail;
      }
      const publishErrors =
        error.payload.error === 'publish_validation_failed' && Array.isArray(error.payload.errors)
          ? error.payload.errors
          : undefined;
      const routeStepAllowed =
        error.payload.error === 'route_step_provider_not_allowed' &&
        Array.isArray(error.payload.allowed)
          ? error.payload.allowed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          : undefined;
      return {
        ...base,
        ...(um ? { userMessage: um } : {}),
        ...(publishErrors ? { publishErrors } : {}),
        ...(routeStepAllowed?.length ? { routeStepAllowedProviders: routeStepAllowed } : {})
      };
    }
    if (error.status === 409) {
      return { ...base, userMessage: error.detail };
    }
    return base;
  }

  if (error instanceof Error) {
    return {
      status: 500,
      code: 'internal_error',
      detail: error.message
    };
  }

  return {
    status: 500,
    code: 'internal_error',
    detail: 'Unknown error'
  };
}

export function restormelJsonError(error: unknown) {
  const serialized = serializeRestormelError(error);
  return json(
    {
      error: 'restormel_dashboard_error',
      restormel: serialized
    },
    { status: serialized.status }
  );
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error('Invalid JSON body');
  }
}
