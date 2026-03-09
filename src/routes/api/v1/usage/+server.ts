import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminDb } from '$lib/server/firebase-admin';
import { isAdminUid } from '$lib/server/apiAuth';
import { problemJson, resolveRequestId } from '$lib/server/problem';
import { logServerAnalytics } from '$lib/server/analytics';

interface UsageKeyRow {
  key_id: string;
  name: string;
  key_prefix: string;
  active: boolean;
  usage_count: number;
  daily_count: number;
  daily_quota: number;
  daily_reset_at: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

export const GET: RequestHandler = async ({ locals, request, url }) => {
  const requestId = resolveRequestId(request);
  const uid = locals.user?.uid;

  if (!uid) {
    return problemJson({
      status: 401,
      title: 'Authentication required',
      detail: 'Provide a valid Firebase bearer token.',
      requestId
    });
  }

  const isAdmin = isAdminUid(uid);
  const ownerUidParam = url.searchParams.get('owner_uid')?.trim();
  const ownerUid = ownerUidParam || uid;

  if (!isAdmin && ownerUid !== uid) {
    return problemJson({
      status: 403,
      title: 'Forbidden',
      detail: 'You can only read usage for your own account.',
      requestId
    });
  }

  const snapshot = await adminDb
    .collection('api_keys')
    .where('owner_uid', '==', ownerUid)
    .orderBy('created_at', 'desc')
    .limit(200)
    .get();

  const keys: UsageKeyRow[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      key_id: doc.id,
      name: data.name ?? 'API key',
      key_prefix: data.key_prefix ?? 'sk-sophia-***',
      active: Boolean(data.active),
      usage_count: data.usage_count ?? 0,
      daily_count: data.daily_count ?? 0,
      daily_quota: data.rate_limit?.daily_quota ?? 100,
      daily_reset_at: data.daily_reset_at?.toDate?.()?.toISOString() ?? null,
      created_at: data.created_at?.toDate?.()?.toISOString() ?? null,
      last_used_at: data.last_used_at?.toDate?.()?.toISOString() ?? null
    };
  });

  const totals = keys.reduce(
    (acc, key) => {
      acc.usage_count += key.usage_count;
      acc.daily_count += key.daily_count;
      acc.daily_quota += key.daily_quota;
      if (key.active) acc.active_keys += 1;
      return acc;
    },
    {
      usage_count: 0,
      daily_count: 0,
      daily_quota: 0,
      active_keys: 0,
      total_keys: keys.length
    }
  );

  await logServerAnalytics({
    event: 'developer_usage_view',
    uid,
    request_id: requestId,
    route: '/api/v1/usage',
    success: true,
    status: 200,
    owner_uid: ownerUid,
    key_count: keys.length
  });

  return json(
    {
      owner_uid: ownerUid,
      totals,
      keys
    },
    {
      headers: {
        'X-Request-Id': requestId
      }
    }
  );
};
