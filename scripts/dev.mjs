#!/usr/bin/env node
/**
 * Local dev entry: load .env, then ensure Firebase Admin can reach Firestore (BYOK list, etc.)
 * by resolving GOOGLE_APPLICATION_CREDENTIALS to an on-disk service account JSON.
 *
 * Convention: place your key at `secrets/firebase-adminsdk.json` (gitignored) or set the env var in `.env`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

dotenv.config({ path: resolve(root, '.env') });
dotenv.config({ path: resolve(root, '.env.local') });

function resolveCredentialPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const abs = isAbsolute(trimmed) ? trimmed : resolve(root, trimmed);
  return existsSync(abs) ? abs : null;
}

/** Prefer explicit env; otherwise common local paths (never committed). */
const credentialCandidates = [
  () => resolveCredentialPath(process.env.GOOGLE_APPLICATION_CREDENTIALS),
  () => resolveCredentialPath(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
  () => resolveCredentialPath(process.env.FIREBASE_ADMIN_SDK_PATH),
  () => resolve(resolve(root, 'secrets/firebase-adminsdk.json')),
  () => resolve(resolve(root, 'secrets/google-application-credentials.json')),
  () => resolve(resolve(root, '.firebase/service-account.json'))
];

let resolved = null;
for (const tryPath of credentialCandidates) {
  const p = typeof tryPath === 'function' ? tryPath() : tryPath;
  if (p) {
    resolved = p;
    break;
  }
}

if (resolved) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolved;
  if (process.env.DEV_VERBOSE_FIREBASE === '1' || process.env.DEV_VERBOSE_FIREBASE === 'true') {
    console.info('[dev] GOOGLE_APPLICATION_CREDENTIALS →', resolved);
  }
} else if (!process.env.FIRESTORE_EMULATOR_HOST?.trim()) {
  console.info(
    '[dev] No service account JSON found (BYOK/Firestore Admin may fail). Add one of:\n' +
      '  • secrets/firebase-adminsdk.json\n' +
      '  • GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON in .env\n' +
      '  • or set FIRESTORE_EMULATOR_HOST for the emulator\n' +
      '  • or rely on degraded BYOK in dev (see BYOK_PROVIDERS_FALLBACK_EMPTY for preview builds)'
  );
}

const viteEntry = resolve(root, 'node_modules/vite/bin/vite.js');
if (!existsSync(viteEntry)) {
  console.error('[dev] Missing vite. Run pnpm install from the repo root.');
  process.exit(1);
}

const child = spawn(process.execPath, [viteEntry, 'dev'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
