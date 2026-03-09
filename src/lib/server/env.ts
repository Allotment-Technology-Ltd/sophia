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

  loaded = true;
}
