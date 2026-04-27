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

/**
 * Catalog `vertex` routes use `GOOGLE_AI_API_KEY` (@restormel/contracts `REASONING_PROVIDER_PLATFORM_API_KEY_ENV`).
 * Merge common alternates so local `.env.local` typos / Google AI Studio naming still work.
 */
function mergeGoogleAiApiKeyAliases(): void {
  if (process.env.GOOGLE_AI_API_KEY?.trim()) return;
  const e = process.env as Record<string, string | undefined>;
  const from =
    e.GEMINI_API_KEY?.trim() ||
    e.GOOGLE_GENAI_API_KEY?.trim() ||
    e.google_AI_API_KEY?.trim() ||
    e.Google_AI_API_KEY?.trim();
  if (from) {
    process.env.GOOGLE_AI_API_KEY = from;
  }
}

/**
 * Restormel env vars are required in production, but are easy to misname in Railway.
 * Accept common aliases so routing doesn't silently fall back to defaults and produce `no_route`.
 */
function mergeRestormelEnvAliases(): void {
  const e = process.env as Record<string, string | undefined>;

  if (!e.RESTORMEL_PROJECT_ID?.trim()) {
    const from = e.RESTORMEL_PROJECT?.trim() || e.RESTORMEL_PROJECTID?.trim();
    if (from) e.RESTORMEL_PROJECT_ID = from;
  }

  // RESTORMEL_ENVIRONMENT_ID must be the Keys environment UUID (e.g. e20e1b20-98ed-47f0-816c-805d9b128d04),
  // not a display name like "production". A wrong value causes no_route / 404 on every resolve call.
  if (!e.RESTORMEL_ENVIRONMENT_ID?.trim()) {
    const from =
      e.RESTORMEL_ENV_ID?.trim() ||
      e.RESTORMEL_ENVIRONMENT?.trim() ||
      e.RESTORMEL_ENVIRONMENTID?.trim();
    if (from) e.RESTORMEL_ENVIRONMENT_ID = from;
  }

  if (!e.RESTORMEL_GATEWAY_KEY?.trim()) {
    const from =
      e.RESTORMEL_KEYS_GATEWAY_KEY?.trim() ||
      e.RESTORMEL_GATEWAY_TOKEN?.trim() ||
      e.RESTORMEL_API_KEY?.trim();
    if (from) e.RESTORMEL_GATEWAY_KEY = from;
  }

  if (!e.RESTORMEL_KEYS_BASE?.trim()) {
    const from = e.RESTORMEL_BASE_URL?.trim() || e.RESTORMEL_KEYS_ORIGIN?.trim();
    if (from) e.RESTORMEL_KEYS_BASE = from;
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

  mergeGoogleAiApiKeyAliases();
  mergeRestormelEnvAliases();

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
