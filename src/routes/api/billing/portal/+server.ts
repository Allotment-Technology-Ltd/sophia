import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureBillingState } from '$lib/server/billing/store';
import { createCustomerPortalSession } from '$lib/server/billing/paddle';
import { BILLING_FEATURE_ENABLED } from '$lib/server/billing/flags';

export const POST: RequestHandler = async ({ locals }) => {
  try {
    if (!BILLING_FEATURE_ENABLED) {
      return json({ error: 'Billing is currently disabled' }, { status: 503 });
    }

    const uid = locals.user?.uid;
    if (!uid) {
      return json({ error: 'Authentication required' }, { status: 401 });
    }

    const state = await ensureBillingState(uid);
    const customerId = state.profile.paddle_customer_id?.trim();
    if (!customerId) {
      return json(
        { error: 'No billing customer is linked to this account yet.' },
        { status: 400 }
      );
    }

    const portalUrl = await createCustomerPortalSession({
      paddleCustomerId: customerId
    });

    return json({ portal_url: portalUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to open billing portal.';
    return json({ error: message }, { status: 502 });
  }
};
