import { json } from '@sveltejs/kit';
import { RestormelDashboardError } from './restormel';

export function serializeRestormelError(error: unknown): {
  status: number;
  code: string;
  detail: string;
  endpoint?: string;
} {
  if (error instanceof RestormelDashboardError) {
    return {
      status: error.status,
      code: error.code,
      detail: error.detail,
      endpoint: error.endpoint
    };
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
