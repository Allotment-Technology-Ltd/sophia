import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BILLING_FEATURE_ENABLED } from '$lib/server/billing/flags';
import { listRecentTransactions } from '$lib/server/billing/paddle';
import { upsertBillingProfile, ensureBillingState } from '$lib/server/billing/store';
import { creditWalletTopup } from '$lib/server/billing/wallet';
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

function parseTopupCents(tx: PaddleTransactionRecord): number {
  const custom = tx.custom_data ?? {};
  const fromCustom = Number(custom.topup_cents);
  if (Number.isFinite(fromCustom) && fromCustom > 0) return Math.floor(fromCustom);

  const total = tx.details?.totals?.total;
  if (typeof total === 'string' && /^\d+$/.test(total)) {
    const cents = Number.parseInt(total, 10);
    if (Number.isFinite(cents) && cents > 0) return cents;
  }
  return 0;
}

function parseTransactionTimestamp(tx: PaddleTransactionRecord): number {
  const iso = tx.updated_at || tx.created_at;
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export const POST: RequestHandler = async ({ locals }) => {
  if (!BILLING_FEATURE_ENABLED) {
    return json({ ok: true, message: 'billing disabled' }, { status: 202 });
  }

  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const all = (await listRecentTransactions(100)) as PaddleTransactionRecord[];
    const mine = all.filter((tx) => (tx.custom_data?.uid ?? null) === uid);

    const completedLike = mine.filter((tx) => {
      const status = String(tx.status ?? '').toLowerCase();
      return status === 'completed' || status === 'paid' || status === 'billed';
    });

    let appliedSubscription = false;
    let creditedTopups = 0;

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

    const topups = completedLike.filter((tx) => (tx.custom_data?.purchase_kind ?? null) === 'topup');
    for (const tx of topups) {
      const amountCents = parseTopupCents(tx);
      if (amountCents <= 0) continue;
      const credited = await creditWalletTopup({
        uid,
        amountCents,
        currency: normalizeCurrency(tx.custom_data?.currency ?? tx.details?.totals?.currency_code ?? 'GBP'),
        idempotencyKey: tx.id,
        provider: 'paddle',
        providerEventId: tx.id,
        note: 'Paddle transaction reconciliation'
      });
      if (credited.credited) creditedTopups += 1;
    }

    const [summary, state] = await Promise.all([
      getEntitlementSummary(uid),
      ensureBillingState(uid)
    ]);

    return json({
      ok: true,
      applied_subscription: appliedSubscription,
      credited_topups: creditedTopups,
      scanned_transactions: mine.length,
      profile: state.profile,
      effective_tier: state.effectiveTier,
      entitlements: summary,
      wallet: state.wallet
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to sync billing state.';
    return json({ error: message }, { status: 502 });
  }
};

