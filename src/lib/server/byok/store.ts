import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '$lib/server/firebase-admin';
import { decryptByokSecret, encryptByokSecret, type EncryptedSecret } from './crypto';
import { type ByokCredentialStatus, type ByokProvider, type ByokProviderStatus, type ProviderApiKeys } from './types';
import { getEnabledByokProviders } from './config';

interface ByokSecretPayload {
  api_key: string;
}

interface ByokProviderRecord extends EncryptedSecret {
  provider: ByokProvider;
  status: ByokCredentialStatus;
  fingerprint_last8: string;
  last_error?: string | null;
  validated_at?: Timestamp | null;
  created_at?: Timestamp;
  updated_at?: Timestamp;
}

function providerRef(uid: string, provider: ByokProvider) {
  return adminDb.collection('users').doc(uid).collection('byokProviders').doc(provider);
}

function buildFingerprintLast8(apiKey: string): string {
  const normalized = apiKey.trim();
  if (!normalized) return '';
  return normalized.slice(-8);
}

function toIso(value: Timestamp | null | undefined): string | null {
  return value?.toDate?.()?.toISOString() ?? null;
}

export async function listByokProviderStatuses(uid: string): Promise<ByokProviderStatus[]> {
  const snapshot = await adminDb.collection('users').doc(uid).collection('byokProviders').get();
  const byProvider = new Map<string, ByokProviderRecord>();
  for (const doc of snapshot.docs) {
    byProvider.set(doc.id, doc.data() as ByokProviderRecord);
  }

  return getEnabledByokProviders().map((provider) => {
    const record = byProvider.get(provider);
    if (!record) {
      return {
        provider,
        configured: false,
        status: 'not_configured',
        fingerprint_last8: null,
        validated_at: null,
        updated_at: null,
        last_error: null
      } satisfies ByokProviderStatus;
    }

    const configured = record.status !== 'revoked';
    return {
      provider,
      configured,
      status: configured ? record.status : 'not_configured',
      fingerprint_last8: configured ? record.fingerprint_last8 : null,
      validated_at: configured ? toIso(record.validated_at) : null,
      updated_at: toIso(record.updated_at),
      last_error: configured ? record.last_error ?? null : null
    } satisfies ByokProviderStatus;
  });
}

export async function upsertByokProviderCredential(
  uid: string,
  provider: ByokProvider,
  apiKey: string
): Promise<ByokProviderStatus> {
  const normalized = apiKey.trim();
  if (!normalized) {
    throw new Error('api_key is required');
  }

  const payload: ByokSecretPayload = { api_key: normalized };
  const encrypted = await encryptByokSecret(JSON.stringify(payload));
  const now = Timestamp.now();

  await providerRef(uid, provider).set(
    {
      provider,
      ...encrypted,
      status: 'pending_validation' as const,
      fingerprint_last8: buildFingerprintLast8(normalized),
      last_error: null,
      validated_at: null,
      updated_at: now,
      created_at: now
    },
    { merge: true }
  );

  return {
    provider,
    configured: true,
    status: 'pending_validation',
    fingerprint_last8: buildFingerprintLast8(normalized),
    validated_at: null,
    updated_at: now.toDate().toISOString(),
    last_error: null
  };
}

export async function setByokProviderValidationStatus(
  uid: string,
  provider: ByokProvider,
  options: { success: boolean; errorMessage?: string | null }
): Promise<void> {
  const now = Timestamp.now();
  await providerRef(uid, provider).set(
    {
      status: options.success ? 'active' : 'invalid',
      validated_at: options.success ? now : null,
      last_error: options.success ? null : options.errorMessage ?? 'validation_failed',
      updated_at: now
    },
    { merge: true }
  );
}

export async function revokeByokProviderCredential(uid: string, provider: ByokProvider): Promise<void> {
  const now = Timestamp.now();
  await providerRef(uid, provider).set(
    {
      status: 'revoked',
      last_error: null,
      validated_at: null,
      updated_at: now,
      ciphertext_b64: FieldValue.delete(),
      iv_b64: FieldValue.delete(),
      tag_b64: FieldValue.delete(),
      kms_key_name: FieldValue.delete(),
      encryption_mode: FieldValue.delete(),
      fingerprint_last8: FieldValue.delete()
    },
    { merge: true }
  );
}

export async function getByokProviderApiKey(
  uid: string,
  provider: ByokProvider,
  options?: { allowPending?: boolean; allowInvalid?: boolean }
): Promise<string | null> {
  const doc = await providerRef(uid, provider).get();
  if (!doc.exists) return null;

  const record = doc.data() as ByokProviderRecord;
  const status = record.status;
  const allowed =
    status === 'active' ||
    (options?.allowPending && status === 'pending_validation') ||
    (options?.allowInvalid && status === 'invalid');
  if (!allowed) return null;

  if (!record.ciphertext_b64) return null;

  const decrypted = await decryptByokSecret(record);
  const payload = JSON.parse(decrypted) as ByokSecretPayload;
  const key = payload.api_key?.trim();
  return key || null;
}

export async function loadByokProviderApiKeys(uid: string): Promise<ProviderApiKeys> {
  const result: ProviderApiKeys = {};
  const keys = await Promise.all(
    getEnabledByokProviders().map(async (provider) => ({
      provider,
      key: await getByokProviderApiKey(uid, provider)
    }))
  );
  for (const item of keys) {
    if (!item.key) continue;
    result[item.provider] = item.key;
  }
  return result;
}
