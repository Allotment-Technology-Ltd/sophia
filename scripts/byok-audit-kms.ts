/**
 * Audit Firestore BYOK docs for legacy Cloud KMS payloads.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/byok-audit-kms.ts
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { loadServerEnv } from '../src/lib/server/env.ts';

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

async function main(): Promise<void> {
  if (!getApps().length) {
    const projectId = resolveFirebaseProjectId();
    if (projectId) initializeApp({ projectId });
    else initializeApp();
  }

  const db = getFirestore();
  const users = await db.collection('users').get();
  const paths: string[] = [];
  let scannedDocs = 0;
  for (const user of users.docs) {
    const providers = await user.ref.collection('byokProviders').get();
    for (const provider of providers.docs) {
      scannedDocs += 1;
      const mode = (provider.data() as { encryption_mode?: string }).encryption_mode;
      if (mode === 'kms') paths.push(provider.ref.path);
    }
  }

  paths.sort();
  console.log(JSON.stringify({ users: users.size, scannedDocs, kmsDocs: paths.length, paths }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

