/**
 * Prints Sophia env lines for Neon Auth JWT verification using the Neon API.
 *
 * Requires:
 *   NEON_API_KEY — from https://console.neon.tech → Account → API keys
 *   NEON_PROJECT_ID — e.g. silent-forest-63826989 (or pass as argv[2])
 *   NEON_BRANCH_ID — e.g. br-quiet-king-abwtgzna (or pass as argv[3])
 *
 * Usage:
 *   pnpm neon:auth-env
 *   pnpm neon:auth-env -- <project_id> <branch_id>
 */

import { loadServerEnv } from '../src/lib/server/env.ts';

loadServerEnv();

const apiKey = process.env.NEON_API_KEY?.trim();
const projectId = (process.argv[2] || process.env.NEON_PROJECT_ID)?.trim();
const branchId = (process.argv[3] || process.env.NEON_BRANCH_ID)?.trim();

if (!apiKey) {
  console.error('NEON_API_KEY is not set. Create a key in the Neon console (Account → API keys).');
  process.exit(1);
}
if (!projectId || !branchId) {
  console.error(
    'Set NEON_PROJECT_ID and NEON_BRANCH_ID, or run: pnpm neon:auth-env -- <project_id> <branch_id>'
  );
  process.exit(1);
}

const url = `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}/auth`;
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
});

if (!res.ok) {
  const body = await res.text();
  console.error(`Neon API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  process.exit(1);
}

const data = (await res.json()) as {
  base_url?: string;
  jwks_url?: string;
  auth_provider?: string;
  db_name?: string;
};

const baseUrl = data.base_url?.trim();
const jwksUrl = data.jwks_url?.trim();

if (!baseUrl || !jwksUrl) {
  console.error('Response missing base_url or jwks_url. Is Neon Auth enabled on this branch?');
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

let origin: string;
try {
  origin = new URL(baseUrl).origin;
} catch {
  console.error('Invalid base_url from API:', baseUrl);
  process.exit(1);
}

console.log('# Neon Auth — add to .env (do not commit secrets)');
console.log(`# Branch auth: ${data.auth_provider ?? 'better_auth'} db=${data.db_name ?? '?'}`);
console.log('');
console.log('USE_NEON_AUTH=1');
console.log(`NEON_AUTH_BASE_URL=${baseUrl}`);
console.log('# Equivalent explicit vars (optional if BASE_URL is set):');
console.log(`# NEON_AUTH_JWKS_URL=${jwksUrl}`);
console.log(`# NEON_AUTH_ISSUER=${origin}`);
console.log(`# NEON_AUTH_AUDIENCE=${origin}`);
