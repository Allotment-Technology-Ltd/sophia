import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSubscriptionCheckout } from '$lib/server/billing/paddle';
import { normalizeCurrency } from '$lib/server/billing/types';
import { ensureBillingState, upsertBillingProfile } from '$lib/server/billing/store';
import { BILLING_FEATURE_ENABLED } from '$lib/server/billing/flags';
import { LEGAL_VERSION } from '$lib/constants/legal';
import { getCheckoutPresentation } from '$lib/server/billing/checkout-settings';
import { founderOfferSummaryFromProfile } from '$lib/server/billing/founder';
import { hasOwnerRole } from '$lib/server/authRoles';
import { getOrCreateDefaultWorkspace } from '$lib/server/billing/workspaces';

interface CheckoutBody {
  tier?: 'pro' | 'premium';
  currency?: 'GBP' | 'USD';
  accept_terms?: boolean;
  accept_privacy?: boolean;
  legal_terms_version?: string;
  legal_privacy_version?: string;
}

export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    if (!BILLING_FEATURE_ENABLED) {
      return json({ error: 'Billing is currently disabled' }, { status: 503 });
    }

    const uid = locals.user?.uid;
    const email = locals.user?.email;
    if (!uid) {
      return json({ error: 'Authentication required' }, { status: 401 });
    }
    if (hasOwnerRole(locals.user)) {
      return json(
        {
          error: 'Owner/admin accounts are exempt from subscriptions and already have premium access.'
        },
        { status: 409 }
      );
    }

    const billingState = await ensureBillingState(uid);
    const existingProfile = billingState.profile;
    const founderOffer = founderOfferSummaryFromProfile(existingProfile);
    if (founderOffer?.active) {
      return json(
        {
          error: `Founder access already includes Premium until ${new Date(founderOffer.expiresAt).toLocaleDateString('en-GB')}. No additional subscription is required.`
        },
        { status: 409 }
      );
    }
    const hasActiveSubscriptionId = Boolean(existingProfile.paddle_subscription_id?.trim());
    const statusBlocksNewCheckout =
      existingProfile.status === 'active' ||
      existingProfile.status === 'trialing' ||
      existingProfile.status === 'past_due';
    const alreadyPaid = billingState.effectiveTier !== 'free';
    if ((hasActiveSubscriptionId && statusBlocksNewCheckout) || alreadyPaid) {
      return json(
        {
          error:
            'An active subscription is already linked to this account. Use Manage subscription to change, upgrade, downgrade, or cancel.'
        },
        { status: 409 }
      );
    }

    let body: CheckoutBody;
    try {
      body = (await request.json()) as CheckoutBody;
    } catch {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const tier = body.tier;
    if (tier !== 'premium' && tier !== 'pro') {
      return json({ error: 'tier must be pro' }, { status: 400 });
    }
    if (body.accept_terms !== true || body.accept_privacy !== true) {
      return json(
        { error: 'You must accept the latest Terms and Privacy Policy to continue.' },
        { status: 400 }
      );
    }

    const legalTermsVersion = body.legal_terms_version?.trim() || LEGAL_VERSION;
    const legalPrivacyVersion = body.legal_privacy_version?.trim() || LEGAL_VERSION;
    const currency = normalizeCurrency(body.currency ?? 'GBP');
    const appUrl = new URL(request.url).origin;
    const workspace = await getOrCreateDefaultWorkspace(uid);

    const session = await createSubscriptionCheckout({
      uid,
      workspaceId: workspace.id,
      email,
      tier: 'premium',
      currency,
      billingPeriod: 'monthly',
      appUrl,
      legalTermsVersion,
      legalPrivacyVersion
    });
    console.info('[BILLING] subscription checkout created', {
      uid,
      tier,
      currency,
      appUrl,
      checkoutHost: (() => {
        try {
          return new URL(session.checkoutUrl).hostname;
        } catch {
          return 'invalid-url';
        }
      })()
    });

    await upsertBillingProfile(uid, {
      currency,
      legal_terms_version: legalTermsVersion,
      legal_privacy_version: legalPrivacyVersion
    });

    const checkoutPresentation = getCheckoutPresentation();
    return json({
      checkout_url: session.checkoutUrl,
      transaction_id: session.transactionId,
      price_id: session.priceId,
      tier: 'pro',
      currency,
      workspace_id: workspace.id,
      checkout_presentation: checkoutPresentation
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to start subscription checkout.';
    return json({ error: message }, { status: 502 });
  }
};
