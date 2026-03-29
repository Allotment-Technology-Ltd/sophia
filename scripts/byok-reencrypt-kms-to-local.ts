/**
 * Re-encrypt BYOK provider docs from Cloud KMS (`encryption_mode: kms`) to local AES-256-GCM.
 *
 * Prerequisites:
 * - Firestore BYOK path `users/{uid}/byokProviders/{provider}` (run when admin datastore is Firestore).
 * - `BYOK_KMS_KEY_NAME` + ADC (or credentials) so KMS decrypt works for existing payloads.
 * - `BYOK_LOCAL_ENCRYPTION_KEY` or `API_KEY_HASH_SECRET` aligned with target runtime (production secret).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/byok-reencrypt-kms-to-local.ts --dry-run
 *   pnpm exec tsx --env-file=.env scripts/byok-reencrypt-kms-to-local.ts --execute
 *   pnpm exec tsx --env-file=.env scripts/byok-reencrypt-kms-to-local.ts --execute --uid=firebaseUid
 *
 * After success: set `BYOK_DISABLE_CLOUD_KMS_ENCRYPT=1` (or unset `BYOK_KMS_KEY_NAME`) so new saves
 * never use KMS; see `.env.example`.
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { BYOK_PROVIDER_ORDER } from '../packages/contracts/src/providers.ts';
import { loadServerEnv } from '../src/lib/server/env.ts';
import {
  decryptByokSecret,
  encryptByokSecret,
  type EncryptedSecret
} from '../src/lib/server/byok/crypto.ts';

loadServerEnv();

function resolveFirebaseProjectId(): string | undefined {
  const direct =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (direct) return direct;
  const firebaseConfig = process.env.FIREBASE_CONFIG?.trim();
  if (!firebaseConfig) return undefined;
  try {
    const parsed = JSON.parse(firebaseConfig) as { projectId?: string };
    return parsed.projectId?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function parseArgs(argv: string[]): { dryRun: boolean; uid: string | null } {
  let dryRun = true;
  let uid: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') dryRun = false;
    if (a === '--dry-run') dryRun = true;
    if (a.startsWith('--uid=')) uid = a.slice('--uid='.length).trim() || null;
  }
  return { dryRun, uid };
}

function resolveTargetUids(explicitUid: string | null): string[] {
  if (explicitUid) return [explicitUid];
  const raw = process.env.OWNER_UIDS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  if (!getApps().length) {
    const projectId = resolveFirebaseProjectId();
    if (projectId) initializeApp({ projectId });
    else initializeApp();
  }
  const adminDb = getFirestore();

  const { dryRun, uid } = parseArgs(process.argv);
  const uids = resolveTargetUids(uid);
  if (uids.length === 0) {
    console.error('No target uids: pass --uid=<firebaseUid> or set OWNER_UIDS (comma-separated).');
    process.exitCode = 1;
    return;
  }

  if (!process.env.BYOK_KMS_KEY_NAME?.trim()) {
    console.warn(
      '[byok-reencrypt] BYOK_KMS_KEY_NAME is unset — KMS decrypt will only work if each doc has kms_key_name.'
    );
  }

  let touched = 0;
  let skipped = 0;

  for (const targetUid of uids) {
    for (const provider of BYOK_PROVIDER_ORDER) {
      const ref = adminDb.collection('users').doc(targetUid).collection('byokProviders').doc(provider);
      const snap = await ref.get();
      if (!snap.exists) {
        skipped += 1;
        continue;
      }
      const data = snap.data() as EncryptedSecret & { provider?: string; status?: string };
      if (data.encryption_mode !== 'kms') {
        skipped += 1;
        continue;
      }
      if (!data.ciphertext_b64) {
        console.warn(`[byok-reencrypt] skip ${targetUid}/${provider}: kms doc missing ciphertext`);
        skipped += 1;
        continue;
      }

      const label = `users/${targetUid}/byokProviders/${provider}`;
      if (dryRun) {
        console.log(`[dry-run] would re-encrypt ${label} (kms_key=${data.kms_key_name ?? '(env)'})`);
        touched += 1;
        continue;
      }

      const plaintext = await decryptByokSecret(data);
      const prevForce = process.env.BYOK_FORCE_LOCAL_ENCRYPTION;
      process.env.BYOK_FORCE_LOCAL_ENCRYPTION = 'true';
      try {
        const encrypted = await encryptByokSecret(plaintext);
        await ref.set(
          {
            ...encrypted,
            updated_at: Timestamp.now()
          },
          { merge: true }
        );
      } finally {
        if (prevForce === undefined) delete process.env.BYOK_FORCE_LOCAL_ENCRYPTION;
        else process.env.BYOK_FORCE_LOCAL_ENCRYPTION = prevForce;
      }
      console.log(`[byok-reencrypt] re-encrypted ${label}`);
      touched += 1;
    }
  }

  console.log(
    `[byok-reencrypt] done dryRun=${dryRun} reencryptedOrWould=${touched} skippedNonKmsOrMissing=${skipped}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
