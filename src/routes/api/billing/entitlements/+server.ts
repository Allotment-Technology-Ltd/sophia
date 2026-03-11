import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEntitlementSummary } from '$lib/server/billing/entitlements';
import { ensureBillingState } from '$lib/server/billing/store';
import { getCheckoutPresentation } from '$lib/server/billing/checkout-settings';
import { getLearnEntitlementSummary } from '$lib/server/learn/entitlements';
import { founderOfferSummaryFromProfile } from '$lib/server/billing/founder';

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const [summary, state, learnSummary] = await Promise.all([
    getEntitlementSummary(uid),
    ensureBillingState(uid),
    getLearnEntitlementSummary(uid)
  ]);

  return json({
    profile: state.profile,
    effective_tier: state.effectiveTier,
    founder_offer: founderOfferSummaryFromProfile(state.profile),
    entitlements: summary,
    learn_entitlements: learnSummary,
    wallet: state.wallet,
    checkout_presentation: getCheckoutPresentation()
  });
};
