import { FieldValue } from '$lib/server/fsCompat';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';

export type WorkspacePlan = 'free' | 'pro';
export type WorkspaceSubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'cancelled'
  | 'paused'
  | 'inactive'
  | 'unknown';

export interface BillingWorkspaceRecord {
  id: string;
  uid: string;
  plan: WorkspacePlan;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
  paddle_transaction_id: string | null;
  subscription_status: WorkspaceSubscriptionStatus;
  plan_updated_at: string | null;
  plan_ended_at: string | null;
  plan_expires_at: string | null;
}

function workspacesRef() {
  return sophiaDocumentsDb.collection('billingWorkspaces');
}

function workspaceRef(workspaceId: string) {
  return workspacesRef().doc(workspaceId);
}

function defaultWorkspaceId(uid: string): string {
  return `default:${uid}`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStatus(value: unknown): WorkspaceSubscriptionStatus {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    raw === 'active' ||
    raw === 'trialing' ||
    raw === 'past_due' ||
    raw === 'canceled' ||
    raw === 'cancelled' ||
    raw === 'paused' ||
    raw === 'inactive'
  ) {
    return raw;
  }
  return 'unknown';
}

function normalizePlan(value: unknown): WorkspacePlan {
  return value === 'pro' ? 'pro' : 'free';
}

function normalizeRecord(
  workspaceId: string,
  uid: string,
  input: Record<string, unknown> | undefined
): BillingWorkspaceRecord {
  return {
    id: workspaceId,
    uid,
    plan: normalizePlan(input?.plan),
    paddle_customer_id: asString(input?.paddle_customer_id),
    paddle_subscription_id: asString(input?.paddle_subscription_id),
    paddle_transaction_id: asString(input?.paddle_transaction_id),
    subscription_status: normalizeStatus(input?.subscription_status),
    plan_updated_at: asString(input?.plan_updated_at),
    plan_ended_at: asString(input?.plan_ended_at),
    plan_expires_at: asString(input?.plan_expires_at)
  };
}

export async function getWorkspaceById(
  workspaceId: string
): Promise<BillingWorkspaceRecord | null> {
  if (!workspaceId.trim()) return null;
  const snap = await workspaceRef(workspaceId).get();
  if (!snap.exists) return null;
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const uid = asString(data.uid);
  if (!uid) return null;
  return normalizeRecord(workspaceId, uid, data);
}

export async function getOrCreateDefaultWorkspace(uid: string): Promise<BillingWorkspaceRecord> {
  const id = defaultWorkspaceId(uid);
  return sophiaDocumentsDb.runTransaction(async (tx) => {
    const ref = workspaceRef(id);
    const snap = await tx.get(ref);
    const now = new Date().toISOString();

    if (snap.exists) {
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const normalized = normalizeRecord(id, uid, data);
      if (normalized.uid !== uid) {
        tx.set(
          ref,
          {
            uid,
            updated_at: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        return { ...normalized, uid };
      }
      return normalized;
    }

    const created: BillingWorkspaceRecord = {
      id,
      uid,
      plan: 'free',
      paddle_customer_id: null,
      paddle_subscription_id: null,
      paddle_transaction_id: null,
      subscription_status: 'inactive',
      plan_updated_at: now,
      plan_ended_at: null,
      plan_expires_at: null
    };
    tx.set(
      ref,
      {
        ...created,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp()
      },
      { merge: false }
    );
    return created;
  });
}

async function findWorkspaceByField(
  field: 'paddle_subscription_id' | 'paddle_customer_id',
  value: string
): Promise<BillingWorkspaceRecord | null> {
  if (!value.trim()) return null;
  const snap = await workspacesRef().where(field, '==', value).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = (doc.data() ?? {}) as Record<string, unknown>;
  const uid = asString(data.uid);
  if (!uid) return null;
  return normalizeRecord(doc.id, uid, data);
}

export async function findWorkspaceBySubscriptionId(
  subscriptionId: string | undefined | null
): Promise<BillingWorkspaceRecord | null> {
  if (!subscriptionId) return null;
  return findWorkspaceByField('paddle_subscription_id', subscriptionId);
}

export async function findWorkspaceByCustomerId(
  customerId: string | undefined | null
): Promise<BillingWorkspaceRecord | null> {
  if (!customerId) return null;
  return findWorkspaceByField('paddle_customer_id', customerId);
}

export async function resolveWorkspaceForWebhook(params: {
  subscriptionId?: string | null;
  customerId?: string | null;
  workspaceId?: string | null;
  uid?: string | null;
}): Promise<{ workspace: BillingWorkspaceRecord; source: string } | null> {
  if (params.subscriptionId) {
    const bySubscription = await findWorkspaceBySubscriptionId(params.subscriptionId);
    if (bySubscription) return { workspace: bySubscription, source: 'paddle_subscription_id' };
  }

  if (params.customerId) {
    const byCustomer = await findWorkspaceByCustomerId(params.customerId);
    if (byCustomer) return { workspace: byCustomer, source: 'paddle_customer_id' };
  }

  if (params.workspaceId) {
    const byId = await getWorkspaceById(params.workspaceId);
    if (byId) return { workspace: byId, source: 'custom_data.workspaceId' };
  }

  if (params.uid) {
    const byUid = await getOrCreateDefaultWorkspace(params.uid);
    return { workspace: byUid, source: 'custom_data.uid_default_workspace' };
  }

  return null;
}

export async function applyWorkspaceSubscriptionLifecycleUpdate(params: {
  workspaceId: string;
  uid: string;
  nextPlan: WorkspacePlan;
  nextStatus: WorkspaceSubscriptionStatus;
  paddleCustomerId?: string | null;
  paddleSubscriptionId?: string | null;
  paddleTransactionId?: string | null;
  planExpiresAt?: string | null;
}): Promise<BillingWorkspaceRecord> {
  const nowIso = new Date().toISOString();
  return sophiaDocumentsDb.runTransaction(async (tx) => {
    const ref = workspaceRef(params.workspaceId);
    const snap = await tx.get(ref);
    const existing = snap.exists
      ? normalizeRecord(
          params.workspaceId,
          params.uid,
          (snap.data() ?? {}) as Record<string, unknown>
        )
      : normalizeRecord(params.workspaceId, params.uid, {});

    const isDowngrade = existing.plan === 'pro' && params.nextPlan === 'free';
    const planEndedAt = params.nextPlan === 'pro' ? null : isDowngrade ? nowIso : existing.plan_ended_at;
    const planExpiresAt = params.nextPlan === 'pro' ? params.planExpiresAt ?? null : null;

    const next: BillingWorkspaceRecord = {
      ...existing,
      uid: params.uid,
      plan: params.nextPlan,
      subscription_status: params.nextStatus,
      paddle_customer_id: params.paddleCustomerId ?? existing.paddle_customer_id,
      paddle_subscription_id: params.paddleSubscriptionId ?? existing.paddle_subscription_id,
      paddle_transaction_id: params.paddleTransactionId ?? existing.paddle_transaction_id,
      plan_updated_at: nowIso,
      plan_ended_at: planEndedAt,
      plan_expires_at: planExpiresAt
    };

    const payload: Record<string, unknown> = {
      ...next,
      updated_at: FieldValue.serverTimestamp()
    };
    if (!snap.exists) payload.created_at = FieldValue.serverTimestamp();
    tx.set(ref, payload, { merge: true });

    return next;
  });
}
