import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hasOwnerRole } from '$lib/server/authRoles';
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

  const ownerDisplay = hasOwnerRole(locals.user);

  const [summary, state, learnSummary] = await Promise.all([
    getEntitlementSummary(uid, { ownerDisplay }),
    ensureBillingState(uid),
    getLearnEntitlementSummary(uid, { ownerBypass: ownerDisplay })
  ]);

  return json({
    profile: state.profile,
    effective_tier: ownerDisplay ? 'premium' : state.effectiveTier,
    is_owner: ownerDisplay,
    founder_offer: founderOfferSummaryFromProfile(state.profile),
    entitlements: summary,
    learn_entitlements: learnSummary,
    checkout_presentation: getCheckoutPresentation()
  });
};
