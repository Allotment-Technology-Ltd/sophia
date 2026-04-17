import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { invalidateRestormelGatewayKeyCache } from '$lib/server/restormel';
import { parseJsonBody } from '$lib/server/restormelAdmin';
import {
  clearRestormelGatewayKey,
  getRestormelGatewayConnectionSummary,
  upsertRestormelGatewayKey
} from '$lib/server/restormelGatewaySettings';

const ENV_GATEWAY_KEY = process.env.RESTORMEL_GATEWAY_KEY?.trim() || '';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  try {
    const summary = await getRestormelGatewayConnectionSummary(ENV_GATEWAY_KEY);
    return json({
      databaseAvailable: Boolean(process.env.DATABASE_URL?.trim()),
      summary
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  const actor = assertAdminAccess(locals);
  if (!process.env.DATABASE_URL?.trim()) {
    return json(
      {
        error:
          'DATABASE_URL is not configured; persist the gateway key via RESTORMEL_GATEWAY_KEY in the deployment environment.'
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400 });
  }

  const rec = body as Record<string, unknown>;
  if (rec.clear === true) {
    try {
      await clearRestormelGatewayKey();
      invalidateRestormelGatewayKeyCache();
      const summary = await getRestormelGatewayConnectionSummary(ENV_GATEWAY_KEY);
      return json({ ok: true, summary });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  const gatewayKey = typeof rec.gatewayKey === 'string' ? rec.gatewayKey : '';
  if (!gatewayKey.trim()) {
    return json({ error: 'Provide gatewayKey (string) or clear: true' }, { status: 400 });
  }

  try {
    await upsertRestormelGatewayKey(gatewayKey, actor.uid);
    invalidateRestormelGatewayKeyCache();
    const summary = await getRestormelGatewayConnectionSummary(ENV_GATEWAY_KEY);
    return json({ ok: true, summary });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};
