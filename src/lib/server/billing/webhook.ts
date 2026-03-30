import { FieldValue } from '$lib/server/fsCompat';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
import { upsertBillingProfile } from './store';
import { mapWebhookCurrency, type PaddleWebhookEvent } from './paddle';
import { normalizeTier } from './types';
import {
  applyWorkspaceSubscriptionLifecycleUpdate,
  resolveWorkspaceForWebhook,
  type WorkspacePlan,
  type WorkspaceSubscriptionStatus
} from './workspaces';

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

function extractWorkspaceId(eventData: Record<string, unknown>): string | undefined {
  const custom = readCustomData(eventData);
  const workspaceId = custom.workspaceId;
  return typeof workspaceId === 'string' ? workspaceId : undefined;
}

function extractTransactionId(eventData: Record<string, unknown>): string | undefined {
  const txId = readString(eventData, 'id');
  return txId || undefined;
}

function normalizeSubscriptionStatus(
  raw: string | undefined,
  fallback: WorkspaceSubscriptionStatus = 'inactive'
): WorkspaceSubscriptionStatus {
  const value = (raw ?? '').trim().toLowerCase();
  if (
    value === 'active' ||
    value === 'trialing' ||
    value === 'past_due' ||
    value === 'canceled' ||
    value === 'cancelled' ||
    value === 'paused' ||
    value === 'inactive'
  ) {
    return value;
  }
  return fallback;
}

function planForStatus(status: WorkspaceSubscriptionStatus): WorkspacePlan {
  if (status === 'active' || status === 'trialing') return 'pro';
  return 'free';
}

function statusForEvent(eventType: string, data: Record<string, unknown>): WorkspaceSubscriptionStatus {
  if (eventType === 'subscription.canceled' || eventType === 'subscription.cancelled') return 'canceled';
  if (eventType === 'subscription.paused') return 'paused';
  if (eventType === 'subscription.past_due') return 'past_due';
  if (eventType === 'subscription.activated') return 'active';
  if (eventType === 'subscription.trialing') return 'trialing';
  if (eventType === 'subscription.created') {
    return normalizeSubscriptionStatus(readString(data, 'status'), 'trialing');
  }
  if (eventType === 'subscription.updated') {
    return normalizeSubscriptionStatus(readString(data, 'status'), 'inactive');
  }
  return normalizeSubscriptionStatus(readString(data, 'status'), 'inactive');
}

async function applyLifecycleFromSubscriptionEvent(
  eventType: string,
  data: Record<string, unknown>
): Promise<{ ok: boolean; message: string }> {
  const customerId = readString(data, 'customer_id') ?? undefined;
  const subscriptionId = readString(data, 'id') ?? undefined;
  const uid = extractUid(data);
  const workspaceId = extractWorkspaceId(data);
  const periodEnd = readString(data, 'current_billing_period_end') ?? null;

  if (uid && customerId) {
    await rememberCustomerUid(customerId, uid);
  }

  const resolved = await resolveWorkspaceForWebhook({
    subscriptionId,
    customerId,
    workspaceId,
    uid
  });
  if (!resolved) {
    console.warn('[BILLING][WEBHOOK] unresolved subscription event target', {
      eventType,
      subscriptionId: subscriptionId ?? null,
      customerId: customerId ?? null,
      workspaceId: workspaceId ?? null,
      uid: uid ?? null
    });
    return { ok: true, message: 'acknowledged: unresolved workspace target' };
  }

  const status = statusForEvent(eventType, data);
  const nextPlan = planForStatus(status);
  const lifecycle = await applyWorkspaceSubscriptionLifecycleUpdate({
    workspaceId: resolved.workspace.id,
    uid: resolved.workspace.uid,
    nextPlan,
    nextStatus: status,
    paddleCustomerId: customerId ?? null,
    paddleSubscriptionId: subscriptionId ?? null,
    planExpiresAt: nextPlan === 'pro' ? periodEnd : null
  });

  await upsertBillingProfile(lifecycle.uid, {
    tier: nextPlan === 'pro' ? 'premium' : 'free',
    status:
      status === 'active' || status === 'trialing' || status === 'past_due'
        ? status
        : status === 'canceled' || status === 'cancelled'
          ? 'canceled'
          : 'inactive',
    currency: mapWebhookCurrency(data),
    paddle_customer_id: customerId ?? null,
    paddle_subscription_id: subscriptionId ?? null,
    period_end_at: nextPlan === 'pro' ? periodEnd : null
  });

  return { ok: true, message: `subscription processed (${resolved.source})` };
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
  const uidFromCustom = extractUid(data);

  if (uidFromCustom && customerId) {
    await rememberCustomerUid(customerId, uidFromCustom);
  }

  if (
    eventType === 'subscription.created' ||
    eventType === 'subscription.activated' ||
    eventType === 'subscription.trialing' ||
    eventType === 'subscription.updated' ||
    eventType === 'subscription.canceled' ||
    eventType === 'subscription.cancelled' ||
    eventType === 'subscription.past_due' ||
    eventType === 'subscription.paused'
  ) {
    return applyLifecycleFromSubscriptionEvent(eventType, data);
  }

  if (eventType === 'transaction.completed' || eventType === 'transaction.paid') {
    const purchaseKind =
      typeof custom.purchase_kind === 'string' ? custom.purchase_kind : undefined;
    if (purchaseKind === 'topup') return { ok: true, message: 'topup ignored (wallet removed)' };

    if (purchaseKind === 'subscription') {
      const uidFromCustomer = await findUidForCustomer(customerId ?? undefined);
      const uid = uidFromCustom ?? uidFromCustomer ?? undefined;
      const workspaceId = extractWorkspaceId(data);
      const transactionId = extractTransactionId(data);
      const subscriptionId = readString(data, 'subscription_id') ?? undefined;
      const resolved = await resolveWorkspaceForWebhook({
        subscriptionId,
        customerId,
        workspaceId,
        uid
      });
      if (!resolved) {
        console.warn('[BILLING][WEBHOOK] unresolved transaction event target', {
          eventType,
          customerId: customerId ?? null,
          subscriptionId: subscriptionId ?? null,
          workspaceId: workspaceId ?? null,
          uid: uid ?? null
        });
        return { ok: true, message: 'acknowledged: unresolved workspace target' };
      }

      await applyWorkspaceSubscriptionLifecycleUpdate({
        workspaceId: resolved.workspace.id,
        uid: resolved.workspace.uid,
        nextPlan: 'pro',
        nextStatus: 'active',
        paddleCustomerId: customerId ?? null,
        paddleSubscriptionId: subscriptionId ?? resolved.workspace.paddle_subscription_id,
        paddleTransactionId: transactionId ?? null
      });

      await upsertBillingProfile(resolved.workspace.uid, {
        tier: normalizeTier(custom.tier),
        status: 'active',
        currency: mapWebhookCurrency(data),
        paddle_customer_id: customerId ?? null,
        paddle_subscription_id: subscriptionId ?? null
      });
      return { ok: true, message: `subscription transaction processed (${resolved.source})` };
    }

    return { ok: true, message: 'transaction webhook ignored' };
  }

  return { ok: true, message: `ignored event type: ${eventType || 'unknown'}` };
}
