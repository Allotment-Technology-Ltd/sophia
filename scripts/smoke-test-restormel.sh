#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

load_env_file ".env"
load_env_file ".env.local"

required_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[smoke:restormel] Missing required env: $name" >&2
    exit 1
  fi
}

required_env "RESTORMEL_GATEWAY_KEY"
required_env "RESTORMEL_PROJECT_ID"
required_env "RESTORMEL_ENVIRONMENT_ID"

normalize_dashboard_client_base() {
  local raw="$1"
  raw="${raw%/}"
  raw="${raw%/keys/dashboard}"
  raw="${raw%/keys}"
  printf '%s\n' "$raw"
}

RAW_RESTORMEL_BASE="${RESTORMEL_KEYS_BASE:-${RESTORMEL_BASE_URL:-https://restormel.dev/keys/dashboard}}"
export RESTORMEL_KEYS_BASE="$(normalize_dashboard_client_base "$RAW_RESTORMEL_BASE")"
export RESTORMEL_SMOKE_ROUTE_ID="${RESTORMEL_SMOKE_ROUTE_ID:-${RESTORMEL_ANALYSE_ROUTE_ID:-}}"

echo "[smoke:restormel] Resolve + policy evaluation"

node --input-type=module <<'EOF'
import { evaluatePolicies, resolve } from '@restormel/keys/dashboard';

const baseUrl = process.env.RESTORMEL_KEYS_BASE;
const projectId = process.env.RESTORMEL_PROJECT_ID;
const environmentId = process.env.RESTORMEL_ENVIRONMENT_ID;
const routeId = process.env.RESTORMEL_SMOKE_ROUTE_ID || undefined;
const token = process.env.RESTORMEL_GATEWAY_KEY;

const blockedModelId = process.env.RESTORMEL_SMOKE_BLOCKED_MODEL_ID?.trim() || undefined;
const blockedProviderType = process.env.RESTORMEL_SMOKE_BLOCKED_PROVIDER_TYPE?.trim() || undefined;

const auth = { type: 'bearer', token };

const resolved = await resolve({
  baseUrl,
  projectId,
  environmentId,
  routeId,
  auth
});

if (!resolved.ok) {
  throw new Error(
    `Resolve failed (${resolved.status} ${resolved.error}): ${resolved.message ?? 'No message'}`
  );
}

if (!resolved.data.providerType || !resolved.data.modelId) {
  throw new Error('Resolve succeeded but providerType/modelId was null.');
}

console.log(
  JSON.stringify(
    {
      resolve: {
        routeId: resolved.data.routeId,
        providerType: resolved.data.providerType,
        modelId: resolved.data.modelId,
        explanation: resolved.data.explanation
      }
    },
    null,
    2
  )
);

const allowed = await evaluatePolicies({
  baseUrl,
  projectId,
  environmentId,
  routeId,
  modelId: resolved.data.modelId,
  providerType: resolved.data.providerType,
  auth
});

if (!allowed.allowed) {
  throw new Error(
    `Allowed-model evaluate unexpectedly failed: ${JSON.stringify(allowed.violations)}`
  );
}

console.log(
  JSON.stringify(
    {
      evaluateAllowed: {
        providerType: resolved.data.providerType,
        modelId: resolved.data.modelId,
        allowed: allowed.allowed,
        violations: allowed.violations
      }
    },
    null,
    2
  )
);

if (blockedModelId && blockedProviderType) {
  const blocked = await evaluatePolicies({
    baseUrl,
    projectId,
    environmentId,
    routeId,
    modelId: blockedModelId,
    providerType: blockedProviderType,
    auth
  });

  if (blocked.allowed) {
    throw new Error(
      `Blocked-model evaluate unexpectedly passed for ${blockedProviderType}:${blockedModelId}`
    );
  }

  console.log(
    JSON.stringify(
      {
        evaluateBlocked: {
          providerType: blockedProviderType,
          modelId: blockedModelId,
          allowed: blocked.allowed,
          violations: blocked.violations
        }
      },
      null,
      2
    )
  );
} else {
  console.log(
    '[smoke:restormel] Skipping blocked-model evaluate. Set RESTORMEL_SMOKE_BLOCKED_MODEL_ID and RESTORMEL_SMOKE_BLOCKED_PROVIDER_TYPE to enable it.'
  );
}
EOF

echo "[smoke:restormel] Restormel Doctor"
npx @restormel/doctor

echo "[smoke:restormel] Restormel Validate"
npx @restormel/validate

echo "[smoke:restormel] OK"
