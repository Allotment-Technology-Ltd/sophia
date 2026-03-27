/**
 * Copy top-level Firestore collections into `sophia_documents` for SOPHIA_DATA_BACKEND=neon.
 *
 *   pnpm migrate:firestore-to-neon
 *   pnpm migrate:firestore-to-neon -- --execute --collection=api_keys
 *
 * Loads `.env` then `.env.local` (same as the app). Subcollections under users/* are not fully recursive yet.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { sophiaDocuments } from '../src/lib/server/db/schema.ts';

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

function parseArgs(argv: string[]): { dryRun: boolean; collection: string | null } {
  let dryRun = true;
  let collection: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') dryRun = false;
    if (a.startsWith('--collection=')) collection = a.split('=')[1] ?? null;
  }
  return { dryRun, collection };
}

function encodeValue(v: unknown): unknown {
  if (v instanceof Timestamp) {
    return { __fsTs: true, seconds: v.seconds, nanoseconds: v.nanoseconds };
  }
  if (v instanceof Date) {
    const ms = v.getTime();
    return { __fsTs: true, seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000 };
  }
  if (Array.isArray(v)) return v.map(encodeValue);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[k] = encodeValue(val);
    }
    return o;
  }
  return v;
}

async function main(): Promise<void> {
  const { dryRun, collection } = parseArgs(process.argv);
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  if (!getApps().length) {
    const projectId = resolveFirebaseProjectId();
    if (projectId) {
      initializeApp({ projectId });
    } else {
      initializeApp();
    }
  }
  const fs = getFirestore();
  const db = getDrizzleDb();

  const targets = collection
    ? [collection]
    : [
        'api_keys',
        'waitlist',
        'analytics',
        'admin_operations',
        'ingestion_run_reports',
        'admin_config',
        'billingCustomers',
        'billingPrograms',
        'billingWebhookEvents'
      ];

  for (const name of targets) {
    console.log(`\n[scan] ${name}`);
    const snap = await fs.collection(name).get();
    console.log(`  docs: ${snap.size}`);
    for (const doc of snap.docs) {
      const path = `${name}/${doc.id}`;
      const data = encodeValue(doc.data()) as Record<string, unknown>;
      const createTime =
        'createTime' in doc && typeof (doc as { createTime?: { toDate?: () => Date } }).createTime?.toDate === 'function'
          ? (doc as { createTime: { toDate: () => Date } }).createTime.toDate()
          : null;
      const sortCreatedAt = createTime;
      if (dryRun) {
        console.log(`  [dry-run] ${path}`);
        continue;
      }
      await db
        .insert(sophiaDocuments)
        .values({
          path,
          topCollection: name,
          data,
          sortCreatedAt,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: sophiaDocuments.path,
          set: { data, sortCreatedAt, updatedAt: new Date() }
        });
      console.log(`  [ok] ${path}`);
    }
  }

  if (dryRun) {
    console.log('\nDry run only. Pass --execute to write to Neon.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
