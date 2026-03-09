import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';

const DEFAULT_DAILY_QUOTA = Number.parseInt(process.env.API_KEY_DAILY_QUOTA ?? '100', 10);

interface ApiKeyRecord {
  key_hash: string;
  owner_uid: string;
  name: string;
  created_at: Timestamp;
  active: boolean;
  usage_count: number;
  daily_count?: number;
  daily_reset_at?: Timestamp;
  last_used_at?: Timestamp;
  rate_limit?: {
    daily_quota?: number;
  };
}

export interface ApiKeyVerificationResult {
  valid: boolean;
  key_id: string | null;
  owner_uid?: string;
  remaining?: number;
  error?: 'missing' | 'invalid' | 'inactive' | 'rate_limited';
}

function getApiKeyHashSecret(): string | null {
  const secret = process.env.API_KEY_HASH_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

function hashApiKeyLegacy(rawApiKey: string): string {
  return createHash('sha256').update(rawApiKey).digest('hex');
}

export function hashApiKey(rawApiKey: string): string {
  const secret = getApiKeyHashSecret();
  if (!secret) {
    return hashApiKeyLegacy(rawApiKey);
  }
  return createHmac('sha256', secret).update(rawApiKey).digest('hex');
}

export function createApiKey(): { rawKey: string; keyId: string; keyHash: string; prefix: string } {
  const keyId = randomBytes(16).toString('hex');
  const rawKey = `sk-sophia-${keyId}`;
  return {
    rawKey,
    keyId,
    keyHash: hashApiKey(rawKey),
    prefix: rawKey.slice(0, 17)
  };
}

export function isAdminUid(uid: string): boolean {
  const adminUids = process.env.ADMIN_UIDS?.split(',').map((value) => value.trim()) ?? [];
  return adminUids.includes(uid);
}

function getDailyQuota(record: ApiKeyRecord): number {
  const configured = record.rate_limit?.daily_quota;
  return typeof configured === 'number' && Number.isFinite(configured) ? configured : DEFAULT_DAILY_QUOTA;
}

export async function verifyApiKey(request: Request): Promise<ApiKeyVerificationResult> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, key_id: null, error: 'missing' };
  }

  const rawApiKey = authHeader.slice(7).trim();
  if (!rawApiKey.startsWith('sk-sophia-')) {
    return { valid: false, key_id: null, error: 'invalid' };
  }

  const hmacHash = hashApiKey(rawApiKey);
  const legacyHash = hashApiKeyLegacy(rawApiKey);

  let snapshot = await adminDb
    .collection('api_keys')
    .where('key_hash', '==', hmacHash)
    .limit(1)
    .get();

  let matchedViaLegacy = false;
  if (snapshot.empty && hmacHash !== legacyHash) {
    snapshot = await adminDb
      .collection('api_keys')
      .where('key_hash', '==', legacyHash)
      .limit(1)
      .get();
    matchedViaLegacy = !snapshot.empty;
  }

  if (snapshot.empty) {
    return { valid: false, key_id: null, error: 'invalid' };
  }

  const doc = snapshot.docs[0];
  const data = doc.data() as ApiKeyRecord;

  if (!data.active) {
    return { valid: false, key_id: doc.id, error: 'inactive' };
  }

  const now = new Date();
  const nowTimestamp = Timestamp.fromDate(now);

  const updateResult = await adminDb.runTransaction(async (tx) => {
    const fresh = await tx.get(doc.ref);
    const latest = fresh.data() as ApiKeyRecord | undefined;

    if (!latest || !latest.active) {
      return { valid: false, error: 'inactive' as const };
    }

    const quota = getDailyQuota(latest);

    const resetAt = latest.daily_reset_at?.toDate?.() ?? new Date(0);
    const shouldReset = resetAt.getTime() <= now.getTime();

    const currentDailyCount = shouldReset ? 0 : latest.daily_count ?? 0;
    if (currentDailyCount >= quota) {
      return { valid: false, error: 'rate_limited' as const, remaining: 0 };
    }

    const updatePayload: Record<string, unknown> = {
      usage_count: (latest.usage_count ?? 0) + 1,
      daily_count: currentDailyCount + 1,
      daily_reset_at: shouldReset
        ? Timestamp.fromDate(new Date(now.getTime() + 24 * 60 * 60 * 1000))
        : latest.daily_reset_at ?? Timestamp.fromDate(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
      last_used_at: nowTimestamp
    };

    if (matchedViaLegacy && getApiKeyHashSecret()) {
      updatePayload.key_hash = hmacHash;
    }

    tx.update(doc.ref, updatePayload);

    return {
      valid: true,
      remaining: Math.max(0, quota - (currentDailyCount + 1)),
      owner_uid: latest.owner_uid
    };
  });

  if (!updateResult.valid) {
    return {
      valid: false,
      key_id: doc.id,
      error: updateResult.error
    };
  }

  return {
    valid: true,
    key_id: doc.id,
    owner_uid: updateResult.owner_uid,
    remaining: updateResult.remaining
  };
}
