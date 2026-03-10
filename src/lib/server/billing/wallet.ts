import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '$lib/server/firebase-admin';
import { applyByokFeeUsage } from './entitlements';
import {
  BYOK_HANDLING_FEE_RATE,
  normalizeCurrency,
  type CurrencyCode
} from './types';
import {
  billingLedgerRef,
  billingWalletRef,
  defaultWallet,
  ensureBillingState
} from './store';

export interface ByokWalletCheckResult {
  ok: boolean;
  requiredCents: number;
  availableCents: number;
}

export interface ByokChargeResult {
  charged: boolean;
  duplicate: boolean;
  insufficient: boolean;
  amountCents: number;
  availableCents: number;
}

export function computeByokFeeCents(estimatedRunCostUsd: number): number {
  if (!Number.isFinite(estimatedRunCostUsd) || estimatedRunCostUsd <= 0) return 0;
  return Math.max(0, Math.round(estimatedRunCostUsd * 100 * BYOK_HANDLING_FEE_RATE));
}

export async function ensureWallet(uid: string): Promise<{
  availableCents: number;
  currency: CurrencyCode;
}> {
  const snapshot = await ensureBillingState(uid);
  return {
    availableCents: snapshot.wallet.available_cents,
    currency: snapshot.wallet.currency
  };
}

export async function assertByokWalletBalance(
  uid: string,
  minimumCents = Number.parseInt(process.env.BYOK_WALLET_MIN_CENTS ?? '1', 10) || 1
): Promise<ByokWalletCheckResult> {
  const { availableCents } = await ensureWallet(uid);
  return {
    ok: availableCents >= minimumCents,
    requiredCents: minimumCents,
    availableCents
  };
}

export async function debitByokHandlingFee(params: {
  uid: string;
  queryRunId: string;
  estimatedRunCostUsd: number;
  currency?: CurrencyCode;
}): Promise<ByokChargeResult> {
  const amountCents = computeByokFeeCents(params.estimatedRunCostUsd);
  if (amountCents <= 0) {
    return {
      charged: false,
      duplicate: false,
      insufficient: false,
      amountCents: 0,
      availableCents: (await ensureWallet(params.uid)).availableCents
    };
  }

  const walletRef = billingWalletRef(params.uid);
  const ledgerRef = billingLedgerRef(params.uid, `byok:${params.queryRunId}`);

  const result = await adminDb.runTransaction(async (tx) => {
    const [walletSnap, ledgerSnap] = await Promise.all([tx.get(walletRef), tx.get(ledgerRef)]);

    if (ledgerSnap.exists) {
      const walletData = walletSnap.exists ? (walletSnap.data() as Record<string, unknown>) : defaultWallet();
      return {
        charged: false,
        duplicate: true,
        insufficient: false,
        amountCents,
        availableCents: Number(walletData.available_cents ?? 0)
      };
    }

    const walletData = walletSnap.exists ? (walletSnap.data() as Record<string, unknown>) : defaultWallet();
    const availableCents = Number(walletData.available_cents ?? 0);
    const walletCurrency = normalizeCurrency(walletData.currency ?? params.currency ?? 'GBP');
    if (availableCents < amountCents) {
      return {
        charged: false,
        duplicate: false,
        insufficient: true,
        amountCents,
        availableCents
      };
    }

    tx.set(
      walletRef,
      {
        currency: walletCurrency,
        available_cents: availableCents - amountCents,
        lifetime_spent_cents: FieldValue.increment(amountCents),
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    tx.set(
      ledgerRef,
      {
        type: 'byok_fee',
        idempotency_key: `byok:${params.queryRunId}`,
        uid: params.uid,
        amount_cents: amountCents,
        currency: walletCurrency,
        fee_rate: BYOK_HANDLING_FEE_RATE,
        estimated_run_cost_usd: params.estimatedRunCostUsd,
        query_run_id: params.queryRunId,
        provider: null,
        provider_event_id: null,
        note: null,
        created_at: FieldValue.serverTimestamp()
      },
      { merge: false }
    );

    return {
      charged: true,
      duplicate: false,
      insufficient: false,
      amountCents,
      availableCents: availableCents - amountCents
    };
  });

  if (result.charged) {
    await applyByokFeeUsage(params.uid, amountCents);
  }

  return result;
}

export async function creditWalletTopup(params: {
  uid: string;
  amountCents: number;
  currency: CurrencyCode;
  idempotencyKey: string;
  provider: 'paddle' | 'manual';
  providerEventId?: string;
  note?: string;
}): Promise<{ credited: boolean; duplicate: boolean; availableCents: number }> {
  if (!Number.isFinite(params.amountCents) || params.amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }

  const walletRef = billingWalletRef(params.uid);
  const ledgerRef = billingLedgerRef(params.uid, `topup:${params.idempotencyKey}`);

  return adminDb.runTransaction(async (tx) => {
    const [walletSnap, ledgerSnap] = await Promise.all([tx.get(walletRef), tx.get(ledgerRef)]);
    const walletData = walletSnap.exists ? (walletSnap.data() as Record<string, unknown>) : defaultWallet();
    const available = Number(walletData.available_cents ?? 0);
    const walletCurrency = normalizeCurrency(walletData.currency ?? params.currency);

    if (ledgerSnap.exists) {
      return {
        credited: false,
        duplicate: true,
        availableCents: available
      };
    }

    const nextAvailable = available + Math.floor(params.amountCents);
    tx.set(
      walletRef,
      {
        currency: walletCurrency,
        available_cents: nextAvailable,
        lifetime_purchased_cents: FieldValue.increment(Math.floor(params.amountCents)),
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    tx.set(
      ledgerRef,
      {
        type: 'topup',
        idempotency_key: `topup:${params.idempotencyKey}`,
        uid: params.uid,
        amount_cents: Math.floor(params.amountCents),
        currency: walletCurrency,
        provider: params.provider,
        provider_event_id: params.providerEventId ?? null,
        query_run_id: null,
        fee_rate: null,
        estimated_run_cost_usd: null,
        note: params.note ?? null,
        created_at: FieldValue.serverTimestamp()
      },
      { merge: false }
    );

    return {
      credited: true,
      duplicate: false,
      availableCents: nextAvailable
    };
  });
}
