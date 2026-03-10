import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEntitlementSummary } from '$lib/server/billing/entitlements';
import { ensureBillingState } from '$lib/server/billing/store';
import { getCheckoutPresentation } from '$lib/server/billing/checkout-settings';

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const [summary, state] = await Promise.all([
    getEntitlementSummary(uid),
    ensureBillingState(uid)
  ]);

  return json({
    profile: state.profile,
    effective_tier: state.effectiveTier,
    entitlements: summary,
    wallet: state.wallet,
    checkout_presentation: getCheckoutPresentation()
  });
};
