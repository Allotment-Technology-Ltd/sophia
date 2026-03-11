import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  convertWalletToScholarCredits,
  getLearnEntitlementSummary,
  SCHOLAR_CREDIT_PRICE_CENTS
} from '$lib/server/learn/entitlements';
import {
  isLearnModuleEnabled,
  learnModuleDisabledResponse,
  requireUid,
  unauthorizedResponse
} from '$lib/server/learn/http';

export const GET: RequestHandler = async ({ locals }) => {
  if (!isLearnModuleEnabled()) return learnModuleDisabledResponse();
  const uid = requireUid(locals);
  if (!uid) return unauthorizedResponse();

  const summary = await getLearnEntitlementSummary(uid);
  return json({
    summary,
    scholar_credit_price_cents: SCHOLAR_CREDIT_PRICE_CENTS
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!isLearnModuleEnabled()) return learnModuleDisabledResponse();
  const uid = requireUid(locals);
  if (!uid) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = (body as { action?: string })?.action;
  if (action === 'convert_wallet_to_scholar_credits') {
    const requested = Number((body as { credits?: number })?.credits ?? 1);
    if (!Number.isFinite(requested) || requested <= 0) {
      return json({ error: 'credits must be a positive number' }, { status: 400 });
    }

    const result = await convertWalletToScholarCredits(uid, requested);
    if (!result.converted) {
      return json(
        {
          error: 'insufficient_wallet_balance',
          required_cents: Math.floor(requested) * SCHOLAR_CREDIT_PRICE_CENTS,
          wallet_available_cents: result.wallet_available_cents,
          summary: result.summary
        },
        { status: 402 }
      );
    }

    return json(result);
  }

  return json({ error: 'unsupported_action' }, { status: 400 });
};
