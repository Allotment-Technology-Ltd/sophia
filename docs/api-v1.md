# SOPHIA Reasoning API v1

## Developer portal

- `GET /developer` — public docs + authenticated key/usage tooling + live playground
- `GET /api-access` — legacy waitlist page
- Hosted gateway portal (recommended for external users): Zuplo developer portal (see runbook)
- OpenAPI contract for gateway import: `docs/openapi/sophia-v1.yaml`

## Authentication model

### Verification endpoint (`/api/v1/verify`)

- Auth: API key
- Header: `Authorization: Bearer sk-sophia-...`

### Management endpoints (`/api/v1/keys`, `/api/v1/usage`)

- Auth: Firebase ID token
- Header: `Authorization: Bearer <firebase-id-token>`
- Access control:
  - Non-admin users can manage only their own keys and usage
  - Admin users can manage/view all owners via `owner_uid`

## Response headers

All v1 endpoints include:

- `X-Request-Id`

`POST /api/v1/verify` also includes:

- `X-Processing-Time-Ms`
- `X-Token-Usage` (JSON mode)

## Error model

Error responses use `application/problem+json` (RFC 9457 style), for example:

```json
{
  "type": "https://docs.usesophia.app/problems/invalid-request",
  "title": "Invalid request",
  "status": 400,
  "detail": "Provide at least one of `text` or `answer`.",
  "request_id": "2b31d57f-..."
}
```

## Endpoints

### `POST /api/v1/verify`

Request body (`application/json`):

```json
{
  "question": "Optional question",
  "answer": "Optional answer to verify",
  "text": "Optional free-form text to verify",
  "domain_hint": "optional domain context",
  "depth": "quick"
}
```

At least one of `text` or `answer` is required.

Modes:

- JSON mode (default): `Accept: application/json`
- Streaming mode: `Accept: text/event-stream`

JSON response includes:

- `request_id`
- `extracted_claims`
- `logical_relations`
- `reasoning_quality`
- `constitutional_check`
- `pass_outputs` (`analysis`, `critique`, `synthesis`)
- `metadata`

SSE events include:

- Engine stream: `pass_start`, `pass_chunk`, `pass_complete`, `pass_structured`, `claims`, `relations`, `sources`, `grounding_sources`, `confidence_summary`, `metadata`
- Verification stream: `extraction_complete`, `reasoning_scores`, `constitution_check`, `verification_complete`
- Errors: `error`

### `GET /api/v1/keys`

Lists API keys.

- Non-admin: only caller-owned keys
- Admin: all keys, optional `owner_uid` filter

### `POST /api/v1/keys`

Creates an API key.

Body:

```json
{
  "name": "My integration",
  "daily_quota": 100,
  "owner_uid": "optional-admin-only-override"
}
```

- Non-admin: `owner_uid` (if provided) must match caller uid
- Admin: may create keys for any owner

Returns raw `api_key` once.

### `DELETE /api/v1/keys`

Revokes an API key.

- Accepts `key_id` in query param or JSON body
- Non-admin: can revoke only owned keys
- Admin: can revoke any key

### `GET /api/v1/usage`

Returns usage summary and per-key usage/quota/reset info.

- Non-admin: own usage only
- Admin: optional `owner_uid` query param to inspect another owner

Example response:

```json
{
  "owner_uid": "firebase_uid",
  "totals": {
    "usage_count": 842,
    "daily_count": 17,
    "daily_quota": 500,
    "active_keys": 2,
    "total_keys": 3
  },
  "keys": [
    {
      "key_id": "...",
      "name": "Production",
      "key_prefix": "sk-sophia-...",
      "active": true,
      "usage_count": 700,
      "daily_count": 9,
      "daily_quota": 300,
      "daily_reset_at": "2026-03-10T12:34:56.000Z",
      "created_at": "2026-03-01T10:00:00.000Z",
      "last_used_at": "2026-03-09T12:31:00.000Z"
    }
  ]
}
```
