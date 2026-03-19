import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '$lib/server/firebase-admin';
import { createApiKey } from '$lib/server/apiAuth';
import { hasAdministratorRole } from '$lib/server/authRoles';
import { problemJson, resolveRequestId } from '$lib/server/problem';
import { logServerAnalytics } from '$lib/server/analytics';

function getAuthContext(user: App.Locals['user']): { uid: string; isAdmin: boolean } | Response {
  if (!user?.uid) {
    return problemJson({
      status: 401,
      title: 'Authentication required',
      detail: 'Provide a valid Firebase bearer token.'
    });
  }

  return { uid: user.uid, isAdmin: hasAdministratorRole(user) };
}

function requestHeaders(requestId: string): HeadersInit {
  return {
    'X-Request-Id': requestId
  };
}

export const GET: RequestHandler = async ({ locals, request, url }) => {
  const requestId = resolveRequestId(request);
  const auth = getAuthContext(locals.user);
  if (auth instanceof Response) return auth;

  const ownerUidParam = url.searchParams.get('owner_uid')?.trim();
  if (!auth.isAdmin && ownerUidParam && ownerUidParam !== auth.uid) {
    return problemJson({
      status: 403,
      title: 'Forbidden',
      detail: 'You can only list your own API keys.',
      requestId
    });
  }

  let query = adminDb.collection('api_keys').orderBy('created_at', 'desc').limit(100);
  if (ownerUidParam) {
    query = query.where('owner_uid', '==', ownerUidParam) as typeof query;
  } else if (!auth.isAdmin) {
    query = query.where('owner_uid', '==', auth.uid) as typeof query;
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
      daily_quota: data.rate_limit?.daily_quota ?? 100,
      daily_reset_at: data.daily_reset_at?.toDate?.()?.toISOString() ?? null
    };
  });

  await logServerAnalytics({
    event: 'developer_key_list',
    uid: auth.uid,
    request_id: requestId,
    route: '/api/v1/keys',
    success: true,
    status: 200,
    key_count: keys.length
  });

  return json({ keys }, { headers: requestHeaders(requestId) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const requestId = resolveRequestId(request);
  const auth = getAuthContext(locals.user);
  if (auth instanceof Response) return auth;

  let body: { name?: string; owner_uid?: string; daily_quota?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const ownerUid = body.owner_uid?.trim() || auth.uid;
  if (!auth.isAdmin && ownerUid !== auth.uid) {
    return problemJson({
      status: 403,
      title: 'Forbidden',
      detail: 'You can only create keys for your own account.',
      requestId
    });
  }

  const name = body.name?.trim() || 'API key';
  const requestedQuota = Number(body.daily_quota);
  const dailyQuota = Number.isFinite(requestedQuota) && requestedQuota > 0 ? Math.floor(requestedQuota) : 100;

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

  await logServerAnalytics({
    event: 'developer_key_create',
    uid: auth.uid,
    key_id: keyId,
    request_id: requestId,
    route: '/api/v1/keys',
    success: true,
    status: 200,
    owner_uid: ownerUid,
    daily_quota: dailyQuota
  });

  return json(
    {
      key_id: keyId,
      api_key: rawKey,
      name,
      owner_uid: ownerUid,
      daily_quota: dailyQuota,
      created_at: now.toDate().toISOString()
    },
    { headers: requestHeaders(requestId) }
  );
};

export const DELETE: RequestHandler = async ({ locals, request, url }) => {
  const requestId = resolveRequestId(request);
  const auth = getAuthContext(locals.user);
  if (auth instanceof Response) return auth;

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
    return problemJson({
      status: 400,
      title: 'Invalid request',
      detail: 'key_id is required.',
      requestId
    });
  }

  const keyRef = adminDb.collection('api_keys').doc(keyId);
  const keyDoc = await keyRef.get();
  if (!keyDoc.exists) {
    return problemJson({
      status: 404,
      title: 'Not found',
      detail: 'API key not found.',
      requestId
    });
  }

  const keyData = keyDoc.data();
  const ownerUid = String(keyData?.owner_uid ?? '');
  if (!auth.isAdmin && ownerUid !== auth.uid) {
    return problemJson({
      status: 403,
      title: 'Forbidden',
      detail: 'You can only revoke your own API keys.',
      requestId
    });
  }

  await keyRef.update({
    active: false,
    revoked_at: Timestamp.now()
  });

  await logServerAnalytics({
    event: 'developer_key_revoke',
    uid: auth.uid,
    key_id: keyId,
    request_id: requestId,
    route: '/api/v1/keys',
    success: true,
    status: 200
  });

  return json({ ok: true, key_id: keyId }, { headers: requestHeaders(requestId) });
};
