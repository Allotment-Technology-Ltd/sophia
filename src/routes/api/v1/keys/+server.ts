import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '$lib/server/firebase-admin';
import { createApiKey, isAdminUid } from '$lib/server/apiAuth';

function requireAdmin(uid: string | undefined): Response | null {
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!isAdminUid(uid)) {
    return json({ error: 'Admin access required' }, { status: 403 });
  }

  return null;
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const adminError = requireAdmin(locals.user?.uid);
  if (adminError) return adminError;

  const ownerUid = url.searchParams.get('owner_uid');
  let query = adminDb.collection('api_keys').orderBy('created_at', 'desc').limit(100);
  if (ownerUid) {
    query = query.where('owner_uid', '==', ownerUid) as typeof query;
  }

  const snapshot = await query.get();

  const keys = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      key_id: doc.id,
      owner_uid: data.owner_uid,
      name: data.name,
      key_prefix: data.key_prefix,
      active: data.active,
      created_at: data.created_at?.toDate?.()?.toISOString() ?? null,
      last_used_at: data.last_used_at?.toDate?.()?.toISOString() ?? null,
      usage_count: data.usage_count ?? 0,
      daily_count: data.daily_count ?? 0,
      daily_quota: data.rate_limit?.daily_quota ?? 100
    };
  });

  return json({ keys });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const adminError = requireAdmin(locals.user?.uid);
  if (adminError) return adminError;

  let body: { name?: string; owner_uid?: string; daily_quota?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const ownerUid = body.owner_uid?.trim() || locals.user?.uid;
  const name = body.name?.trim() || 'API key';
  const dailyQuota = Number.isFinite(body.daily_quota) ? Number(body.daily_quota) : 100;

  if (!ownerUid) {
    return json({ error: 'owner_uid is required' }, { status: 400 });
  }

  const { rawKey, keyId, keyHash, prefix } = createApiKey();
  const now = Timestamp.now();

  await adminDb.collection('api_keys').doc(keyId).set({
    key_hash: keyHash,
    owner_uid: ownerUid,
    name,
    key_prefix: prefix,
    created_at: now,
    active: true,
    usage_count: 0,
    daily_count: 0,
    daily_reset_at: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    rate_limit: {
      daily_quota: dailyQuota
    }
  });

  return json({
    key_id: keyId,
    api_key: rawKey,
    name,
    owner_uid: ownerUid,
    daily_quota: dailyQuota,
    created_at: now.toDate().toISOString()
  });
};

export const DELETE: RequestHandler = async ({ locals, request, url }) => {
  const adminError = requireAdmin(locals.user?.uid);
  if (adminError) return adminError;

  let keyId = url.searchParams.get('key_id');

  if (!keyId) {
    try {
      const body = (await request.json()) as { key_id?: string };
      keyId = body.key_id ?? null;
    } catch {
      keyId = null;
    }
  }

  if (!keyId) {
    return json({ error: 'key_id is required' }, { status: 400 });
  }

  await adminDb.collection('api_keys').doc(keyId).update({
    active: false,
    revoked_at: Timestamp.now()
  });

  return json({ ok: true, key_id: keyId });
};
