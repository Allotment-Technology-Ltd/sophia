import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { acknowledgeFounderOfferNotice, ensureBillingState } from '$lib/server/billing/store';
import { founderOfferSummaryFromProfile } from '$lib/server/billing/founder';

export const POST: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  await acknowledgeFounderOfferNotice(uid);
  const state = await ensureBillingState(uid);
  return json({
    ok: true,
    founder_offer: founderOfferSummaryFromProfile(state.profile)
  });
};
