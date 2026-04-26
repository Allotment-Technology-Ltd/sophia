import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';

const ENV_GATEWAY_KEY = process.env.RESTORMEL_GATEWAY_KEY?.trim() || '';

function last4(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  return t.length <= 4 ? '****' : t.slice(-4);
}

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  return json({
    databaseAvailable: Boolean(process.env.DATABASE_URL?.trim()),
    summary: {
      source: ENV_GATEWAY_KEY ? 'environment' : 'none',
      last4: last4(ENV_GATEWAY_KEY),
      configured: ENV_GATEWAY_KEY.length > 0,
      hasDatabaseRow: false
    }
  });
};

export const PUT: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  return json(
    { error: 'Restormel gateway key is configured only through RESTORMEL_GATEWAY_KEY.' },
    { status: 405 }
  );
};
