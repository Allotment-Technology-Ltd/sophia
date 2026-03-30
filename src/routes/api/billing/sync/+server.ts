import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BILLING_FEATURE_ENABLED } from '$lib/server/billing/flags';
import { listRecentTransactions } from '$lib/server/billing/paddle';
import { upsertBillingProfile, ensureBillingState } from '$lib/server/billing/store';
import { normalizeCurrency, normalizeTier } from '$lib/server/billing/types';
import { getEntitlementSummary } from '$lib/server/billing/entitlements';

type TransactionStatus =
  | 'completed'
  | 'paid'
  | 'billed'
  | 'ready'
  | 'draft'
  | 'past_due'
  | 'canceled'
  | 'cancelled'
  | string;

interface PaddleTransactionRecord {
  id: string;
  status?: TransactionStatus;
  customer_id?: string | null;
  subscription_id?: string | null;
  custom_data?: Record<string, unknown>;
  details?: {
    totals?: {
      total?: string;
      currency_code?: string;
    };
  };
  created_at?: string;
  updated_at?: string;
}

function parseTransactionTimestamp(tx: PaddleTransactionRecord): number {
  const iso = tx.updated_at || tx.created_at;
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!BILLING_FEATURE_ENABLED) {
    return json({ ok: true, message: 'billing disabled' }, { status: 202 });
  }

  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const all = (await listRecentTransactions(100, { appUrl: new URL(request.url).origin })) as PaddleTransactionRecord[];
    const mine = all.filter((tx) => (tx.custom_data?.uid ?? null) === uid);

    const completedLike = mine.filter((tx) => {
      const status = String(tx.status ?? '').toLowerCase();
      return status === 'completed' || status === 'paid' || status === 'billed';
    });

    let appliedSubscription = false;
    const latestSubscription = completedLike
      .filter((tx) => (tx.custom_data?.purchase_kind ?? null) === 'subscription')
      .sort((a, b) => parseTransactionTimestamp(b) - parseTransactionTimestamp(a))[0];

    if (latestSubscription) {
      const custom = latestSubscription.custom_data ?? {};
      await upsertBillingProfile(uid, {
        tier: normalizeTier(custom.tier),
        status: 'active',
        currency: normalizeCurrency(custom.currency ?? latestSubscription.details?.totals?.currency_code ?? 'GBP'),
        paddle_customer_id: latestSubscription.customer_id ?? null,
        paddle_subscription_id:
          typeof latestSubscription.subscription_id === 'string'
            ? latestSubscription.subscription_id
            : null
      });
      appliedSubscription = true;
    }

    const [summary, state] = await Promise.all([
      getEntitlementSummary(uid),
      ensureBillingState(uid)
    ]);

    return json({
      ok: true,
      applied_subscription: appliedSubscription,
      scanned_transactions: mine.length,
      profile: state.profile,
      effective_tier: state.effectiveTier,
      entitlements: summary
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to sync billing state.';
    return json({ error: message }, { status: 502 });
  }
};
