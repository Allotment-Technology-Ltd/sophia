import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  parsePaddleWebhook,
  verifyPaddleWebhookSignature
} from '$lib/server/billing/paddle';
import { handlePaddleWebhookEvent } from '$lib/server/billing/webhook';
import { BILLING_FEATURE_ENABLED } from '$lib/server/billing/flags';

export const POST: RequestHandler = async ({ request }) => {
  if (!BILLING_FEATURE_ENABLED) {
    return json({ ok: true, message: 'billing disabled' }, { status: 202 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('paddle-signature');

  if (!verifyPaddleWebhookSignature(rawBody, signature)) {
    return json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  let event;
  try {
    event = parsePaddleWebhook(rawBody);
  } catch {
    return json({ error: 'Invalid webhook payload' }, { status: 400 });
  }

  const outcome = await handlePaddleWebhookEvent(event);
  return json(outcome);
};
