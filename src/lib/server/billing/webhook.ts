import { FieldValue } from '$lib/server/fsCompat';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
import { creditWalletTopup } from './wallet';
import { upsertBillingProfile } from './store';
import { mapWebhookCurrency, type PaddleWebhookEvent } from './paddle';
import { normalizeTier } from './types';

function customerMapRef(customerId: string) {
  return sophiaDocumentsDb.collection('billingCustomers').doc(customerId);
}

function webhookEventRef(eventId: string) {
  return sophiaDocumentsDb.collection('billingWebhookEvents').doc(eventId);
}

async function rememberCustomerUid(customerId: string, uid: string): Promise<void> {
  await customerMapRef(customerId).set(
    {
      uid,
      updated_at: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

async function findUidForCustomer(customerId: string | undefined): Promise<string | null> {
  if (!customerId) return null;
  const snap = await customerMapRef(customerId).get();
  const uid = snap.data()?.uid;
  return typeof uid === 'string' ? uid : null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

function readCustomData(eventData: Record<string, unknown>): Record<string, unknown> {
  const custom = eventData.custom_data;
  return custom && typeof custom === 'object' ? (custom as Record<string, unknown>) : {};
}

function extractUid(eventData: Record<string, unknown>): string | undefined {
  const custom = readCustomData(eventData);
  const uid = custom.uid;
  return typeof uid === 'string' ? uid : undefined;
}

function extractTopupCents(eventData: Record<string, unknown>): number {
  const custom = readCustomData(eventData);
  const fromCustom = Number(custom.topup_cents);
  if (Number.isFinite(fromCustom) && fromCustom > 0) return Math.floor(fromCustom);
  return 0;
}

export async function handlePaddleWebhookEvent(event: PaddleWebhookEvent): Promise<{
  ok: boolean;
  message: string;
}> {
  const eventType = event.event_type ?? '';
  const eventId = event.event_id ?? '';
  if (eventId) {
    const shouldProcess = await sophiaDocumentsDb.runTransaction(async (tx) => {
      const ref = webhookEventRef(eventId);
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, {
        event_type: eventType || 'unknown',
        first_seen_at: FieldValue.serverTimestamp(),
        processed_at: FieldValue.serverTimestamp()
      });
      return true;
    });
    if (!shouldProcess) {
      return { ok: true, message: 'duplicate event ignored' };
    }
  }

  const fallbackEventId = eventId || `event:${Date.now()}`;
  const data = (event.data ?? {}) as Record<string, unknown>;
  const custom = readCustomData(data);
  const customerId = readString(data, 'customer_id');
  const subscriptionId = readString(data, 'id');
  const uidFromCustom = extractUid(data);
  const uid = uidFromCustom ?? (await findUidForCustomer(customerId)) ?? undefined;

  if (uidFromCustom && customerId) {
    await rememberCustomerUid(customerId, uidFromCustom);
  }

  if (eventType.startsWith('subscription.')) {
    if (!uid) {
      return { ok: true, message: 'subscription webhook ignored: uid unavailable' };
    }
    const tier = normalizeTier(custom.tier);
    const periodEnd = readString(data, 'current_billing_period_end') ?? null;
    const statusRaw = readString(data, 'status') ?? 'active';
    const status =
      statusRaw === 'active' || statusRaw === 'trialing' || statusRaw === 'past_due'
        ? statusRaw
        : statusRaw === 'canceled' || statusRaw === 'cancelled'
          ? 'canceled'
          : 'inactive';

    const nextTier =
      eventType === 'subscription.canceled' || eventType === 'subscription.cancelled'
        ? 'free'
        : tier;

    await upsertBillingProfile(uid, {
      tier: nextTier,
      status: eventType.startsWith('subscription.cancel') ? 'canceled' : status,
      currency: mapWebhookCurrency(data),
      paddle_customer_id: customerId ?? null,
      paddle_subscription_id: subscriptionId ?? null,
      period_end_at: periodEnd
    });
    return { ok: true, message: 'subscription processed' };
  }

  if (eventType === 'transaction.completed' || eventType === 'transaction.paid') {
    const purchaseKind =
      typeof custom.purchase_kind === 'string' ? custom.purchase_kind : undefined;
    if (purchaseKind === 'topup' && uid) {
      const topupCents = extractTopupCents(data);
      if (topupCents > 0) {
        await creditWalletTopup({
          uid,
          amountCents: topupCents,
          currency: mapWebhookCurrency(data),
          idempotencyKey: fallbackEventId,
          provider: 'paddle',
          providerEventId: fallbackEventId,
          note: `Paddle ${eventType}`
        });
      }
      return { ok: true, message: 'topup processed' };
    }

    if (purchaseKind === 'subscription' && uid) {
      const tier = normalizeTier(custom.tier);
      await upsertBillingProfile(uid, {
        tier,
        status: 'active',
        currency: mapWebhookCurrency(data),
        paddle_customer_id: customerId ?? null
      });
      return { ok: true, message: 'subscription transaction processed' };
    }

    return { ok: true, message: 'transaction webhook ignored' };
  }

  return { ok: true, message: `ignored event type: ${eventType || 'unknown'}` };
}
