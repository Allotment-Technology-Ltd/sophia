import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createTopupCheckout } from '$lib/server/billing/paddle';
import { normalizeCurrency } from '$lib/server/billing/types';
import { BILLING_FEATURE_ENABLED } from '$lib/server/billing/flags';
import { LEGAL_VERSION } from '$lib/constants/legal';
import { upsertBillingProfile } from '$lib/server/billing/store';
import { getCheckoutPresentation } from '$lib/server/billing/checkout-settings';

interface TopupBody {
  pack?: 'small' | 'large';
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

    let body: TopupBody;
    try {
      body = (await request.json()) as TopupBody;
    } catch {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const pack = body.pack === 'large' ? 'large' : 'small';
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
    const session = await createTopupCheckout({
      uid,
      email,
      currency,
      pack,
      appUrl
    });
    console.info('[BILLING] topup checkout created', {
      uid,
      pack,
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
      price_id: session.priceId,
      pack,
      currency,
      credited_cents_on_success: session.topupCents,
      checkout_presentation: checkoutPresentation
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to start wallet top-up checkout.';
    return json({ error: message }, { status: 502 });
  }
};
