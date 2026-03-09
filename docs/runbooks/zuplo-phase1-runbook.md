# Zuplo + PostHog Phase 1 Runbook

## Purpose

Set up Phase 1 of the SOPHIA developer platform using Zuplo as the external API gateway/developer portal and PostHog as analytics source of truth.

## Prerequisites

- Existing PostHog account
- New dedicated PostHog project for SOPHIA API
- Zuplo account and project
- Deployed SOPHIA backend (`/api/v1/verify`) on Cloud Run

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

## 2) Prepare Zuplo gateway

1. Create a Zuplo project for `sophia-api-gateway`.
2. Import [docs/openapi/sophia-v1.yaml](../openapi/sophia-v1.yaml).
3. Configure upstream for `POST /api/v1/verify` to Cloud Run base URL.
4. Configure API key auth in Zuplo (gateway-managed keys).
5. Add policies:
   - per-key rate limiting
   - quota enforcement
   - request ID pass-through (`x-request-id`, `x-zuplo-request-id`)

## 3) Developer portal setup

1. Publish quickstart in Zuplo portal with JSON + SSE examples.
2. Add error model examples (`application/problem+json`).
3. Add support troubleshooting section using `X-Request-Id`.

## 4) SOPHIA app configuration

1. Optionally set `PUBLIC_ZUPLO_DEVELOPER_PORTAL_URL` in app env to show hosted portal link on `/developer`.
2. Keep `/api/v1/verify` contract stable; Zuplo is edge layer only.

## 5) Validation checklist

- JSON verify call succeeds through Zuplo
- SSE verify call succeeds through Zuplo
- 401/429/500 responses include `application/problem+json` + `X-Request-Id`
- PostHog receives baseline events:
  - `developer_portal_view`
  - `developer_quickstart_view`
  - `developer_playground_request_start`
  - `developer_playground_request_success`
  - `developer_playground_request_error`
  - `developer_verify_429`
- Request IDs are consistent in Zuplo logs, backend logs, and support payloads

## 6) Rollback

- Remove Zuplo route exposure and point clients back to direct backend endpoint.
- Keep PostHog analytics enabled; no backend schema rollback required.
