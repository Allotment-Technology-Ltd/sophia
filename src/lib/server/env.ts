import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let loaded = false;

/** Admin-spawned ingest pins must survive dotenv (especially `.env.local` with `override: true`). */
function snapshotIngestPinEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith('INGEST_PIN_')) continue;
    const v = process.env[key];
    if (typeof v === 'string' && v.trim() !== '') out[key] = v;
  }
  return out;
}

function restoreIngestPinEnv(snapshot: Record<string, string>): void {
  for (const [k, v] of Object.entries(snapshot)) {
    process.env[k] = v;
  }
}

export function loadServerEnv(): void {
  if (loaded) return;

  const pinSnapshot = snapshotIngestPinEnv();

  const cwd = process.cwd();
  const envPath = join(cwd, '.env');
  const envLocalPath = join(cwd, '.env.local');

  if (existsSync(envPath)) {
    config({ path: envPath });
  }

  // .env.local should override .env when both exist
  if (existsSync(envLocalPath)) {
    config({ path: envLocalPath, override: true });
  }

  restoreIngestPinEnv(pinSnapshot);

  if (
    Object.keys(pinSnapshot).length > 0 &&
    (process.env.INGEST_LOG_PINS === '1' || process.env.INGEST_LOG_PINS === 'true')
  ) {
    console.log(
      `[INGEST_PINS] loadServerEnv: restored ${Object.keys(pinSnapshot).length} INGEST_PIN_* key(s) after dotenv`
    );
  }

  // When `pnpm dev` auto-tunnel is active, preserve tunneled Surreal URL.
  // This avoids .env.local overriding it back to private VPC IP for local runs.
  if (
    process.env.DEV_SURREAL_TUNNEL_ACTIVE === '1' &&
    typeof process.env.DEV_SURREAL_TUNNEL_URL === 'string' &&
    process.env.DEV_SURREAL_TUNNEL_URL.trim()
  ) {
    process.env.SURREAL_URL = process.env.DEV_SURREAL_TUNNEL_URL.trim();
  }

  loaded = true;
}
