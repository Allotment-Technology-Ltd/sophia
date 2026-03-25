import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let loaded = false;

export function loadServerEnv(): void {
  if (loaded) return;

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
