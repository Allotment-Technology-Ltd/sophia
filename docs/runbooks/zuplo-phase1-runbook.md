# Zuplo + PostHog Phase 1 Runbook

## Purpose

Set up Phase 1 of the SOPHIA developer platform using Zuplo as the external API gateway/developer portal and PostHog as analytics source of truth.

## Prerequisites

- Existing PostHog account
- New dedicated PostHog project for SOPHIA API
- Zuplo account and project (`sophia-api-gateway`)
- Deployed SOPHIA backend (`/api/v1/verify`) on Cloud Run
- `API_KEY_HASH_SECRET` mounted in Cloud Run (secret: `api-key-hash-secret`)

---

## 1) Create PostHog project

1. In existing PostHog account, create a project named `SOPHIA API`.
2. Copy the project API key.
3. Configure backend env vars (used by server-side `posthog-node` SDK):

```bash
POSTHOG_HOST=https://eu.i.posthog.com
POSTHOG_PROJECT_API_KEY=<posthog_project_api_key>
POSTHOG_PROJECT_ID=<posthog_project_id>
ENABLE_FIRESTORE_ANALYTICS_FALLBACK=false
```

---

## 2) Cloud Run: admin UID and secrets

### ADMIN_UIDS secret (Secret Manager: `admin-uids`)

The secret is comma-separated Firebase UIDs. Current value includes both the primary admin and the Zuplo service account UID. To update:

```bash
# Read current value
gcloud secrets versions access latest --secret=admin-uids --project=sophia-488807

# Add new UID (do NOT lose existing values)
printf 'EXISTING_UID,NEW_UID' | gcloud secrets versions add admin-uids \
  --project=sophia-488807 --data-file=-

# Force new Cloud Run revision to pick up new version
gcloud run deploy sophia --region=europe-west2 --project=sophia-488807 \
  --image=$(gcloud run services describe sophia --region=europe-west2 \
    --project=sophia-488807 --format='value(spec.template.spec.containers[0].image)')
```

### API_KEY_HASH_SECRET

Must be mounted in Cloud Run from Secret Manager secret `api-key-hash-secret`. Already configured in revision `sophia-00089-pxg+`.

```bash
# Mount if missing
gcloud run services update sophia --region=europe-west2 --project=sophia-488807 \
  --update-secrets="API_KEY_HASH_SECRET=api-key-hash-secret:latest"
```

---

## 3) Create dedicated upstream backend key (SOPHIA → Zuplo service account)

The Zuplo gateway needs its own `sk-sophia-…` key to authenticate against the SOPHIA backend. This is separate from consumer Zuplo API keys (`zpka_…`).

### Prerequisites
- Firebase UID for the Zuplo service account must be in `ADMIN_UIDS` (done above)
- A Firebase ID token for that UID (see minting steps below)

### Mint Firebase ID token for admin UID

```bash
# 1. Create a temporary firebase-adminsdk SA key
gcloud iam service-accounts keys create /tmp/firebase-adminsdk-key.json \
  --iam-account=firebase-adminsdk-fbsvc@sophia-488807.iam.gserviceaccount.com \
  --project=sophia-488807

# 2. Mint custom token via firebase-admin
node --input-type=module << 'EOF'
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFile } from 'node:fs/promises';
const sa = JSON.parse(await readFile('/tmp/firebase-adminsdk-key.json', 'utf8'));
const app = initializeApp({ credential: cert(sa) });
process.stdout.write(await getAuth(app).createCustomToken('<ZUPLO_ADMIN_UID>'));
EOF

# 3. Exchange custom token for ID token (replace CUSTOM_TOKEN and FIREBASE_API_KEY)
curl -s -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=<FIREBASE_WEB_API_KEY>" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<CUSTOM_TOKEN>","returnSecureToken":true}' | jq .idToken

# 4. Delete the temporary SA key immediately
gcloud iam service-accounts keys delete <KEY_ID> \
  --iam-account=firebase-adminsdk-fbsvc@sophia-488807.iam.gserviceaccount.com \
  --project=sophia-488807 --quiet
rm /tmp/firebase-adminsdk-key.json
```

### Create the key

```bash
curl -X POST "https://sophia-210020077715.europe-west2.run.app/api/v1/keys" \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Zuplo upstream","daily_quota":100000}'
# → {"key_id":"...","api_key":"sk-sophia-...","daily_quota":100000,...}
```

The `api_key` value (`sk-sophia-…`) becomes `SOPHIA_BACKEND_API_KEY` in Zuplo.

> **Current active key:** stored in Secret Manager as `sophia-backend-api-key` (project `sophia-488807`).
> Retrieve with: `gcloud secrets versions access latest --secret=sophia-backend-api-key --project=sophia-488807`

---

## 4) Prepare Zuplo gateway

### 4a) Set environment variable

In the Zuplo portal ([portal.zuplo.com](https://portal.zuplo.com)):

1. Open project `sophia-api-gateway` → **Settings** → **Environment Variables**
2. Add variable:
   - **Name:** `SOPHIA_BACKEND_API_KEY`
   - **Value:** `sk-sophia-<key_id>` (retrieve from Secret Manager: `sophia-backend-api-key`)
   - **Secret:** ✓ (mark as secret so it is not logged)
3. Save and redeploy.

### 4b) Configure route policy to inject upstream Authorization

The route `POST /api/v1/verify` must:
1. Validate the **inbound** caller key via `api-key-inbound` (already configured)
2. **Replace** the `Authorization` header before forwarding to SOPHIA backend

In the Zuplo portal, open the route `POST /api/v1/verify` → **Policies** → **Request (Inbound)** and add the following policy **after** `api-key-inbound`:

```json
{
  "name": "inject-sophia-backend-auth",
  "policyType": "change-request-headers-inbound",
  "handler": {
    "export": "default",
    "module": "$import(@zuplo/runtime)",
    "options": {
      "headers": {
        "Authorization": {
          "value": "Bearer $env(SOPHIA_BACKEND_API_KEY)",
          "overwrite": true
        }
      }
    }
  }
}
```

This overwrites the caller's `Authorization` header (their `zpka_…` key) with the backend `sk-sophia-…` key before the request is forwarded to Cloud Run. The inbound `api-key-inbound` policy has already validated and consumed the caller's key.

> **Policy ordering matters:** `api-key-inbound` must run before `inject-sophia-backend-auth`.

### 4c) Existing inbound policies to keep active

- `api-key-inbound` — validates caller Zuplo consumer key
- `rate-limit-inbound` — per-key rate limiting
- `quota-inbound` — daily quota enforcement

---

## 5) Developer portal setup

1. Publish quickstart in Zuplo portal with JSON + SSE examples.
2. Add error model examples (`application/problem+json`).
3. Add support troubleshooting section using `X-Request-Id`.

---

## 6) SOPHIA app configuration

1. Optionally set `PUBLIC_ZUPLO_DEVELOPER_PORTAL_URL` in app env to show hosted portal link on `/developer`.
2. Keep `/api/v1/verify` contract stable; Zuplo is edge layer only.

---

## 7) Validation

Run these after Zuplo env var and policy are configured.

### 7a) Missing auth → 401

```bash
curl -i -X POST "https://sophia-api-gateway-main-900b8f2.d2.zuplo.dev/api/v1/verify" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"text":"test"}'
# Expected: HTTP 401
```

### 7b) Invalid Zuplo key → 401

```bash
curl -i -X POST "https://sophia-api-gateway-main-900b8f2.d2.zuplo.dev/api/v1/verify" \
  -H "Authorization: Bearer zpka_invalid" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"text":"test"}'
# Expected: HTTP 401
```

### 7c) Valid key, JSON mode → 200

```bash
ZUPLO_KEY="<zpka_your_consumer_key>"

curl -i -X POST "https://sophia-api-gateway-main-900b8f2.d2.zuplo.dev/api/v1/verify" \
  -H "Authorization: Bearer ${ZUPLO_KEY}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"text":"Models should disclose uncertainty when evidence is incomplete."}'
# Expected: HTTP 200
# Response fields: request_id, extracted_claims, logical_relations, reasoning_quality
# Headers: X-Request-Id, X-Processing-Time-Ms
```

### 7d) Valid key, SSE mode

```bash
curl -i -X POST "https://sophia-api-gateway-main-900b8f2.d2.zuplo.dev/api/v1/verify" \
  -H "Authorization: Bearer ${ZUPLO_KEY}" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"text":"Models should disclose uncertainty when evidence is incomplete."}' \
  --no-buffer
# Expected: stream of data: {...} events ending with verification_complete
```

### 7e) Direct backend must still reject Zuplo consumer key

```bash
curl -i -X POST "https://sophia-210020077715.europe-west2.run.app/api/v1/verify" \
  -H "Authorization: Bearer ${ZUPLO_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"text":"test"}'
# Expected: HTTP 401 (zpka_ key is not a sk-sophia- key)
```

---

## 8) Rollback

- Remove Zuplo route exposure and point clients back to direct backend endpoint.
- Keep PostHog analytics enabled; no backend schema rollback required.
- To revoke the upstream backend key: `DELETE /api/v1/keys?key_id=bf776bc027f2fd0ab2b960d989c65cc8` with an admin Firebase token.

---

## Security notes

- The `sk-sophia-…` backend key is stored in Secret Manager (`sophia-backend-api-key`). Retrieve it only when needed; do not log or commit it.
- The temporary firebase-adminsdk SA key used to mint tokens must be deleted immediately after use (30 second window max).
- Rotate the `SOPHIA_BACKEND_API_KEY` every 90 days: create a new key via `POST /api/v1/keys`, update Zuplo env var, redeploy, then revoke the old key.
- The `ZV01xuSKQpgojvNvXJjMD3eipDh2` Firebase UID is a service account identity in ADMIN_UIDS. It has no password and can only mint tokens via firebase-adminsdk. Do not add it to `ALLOWED_EMAILS`.
