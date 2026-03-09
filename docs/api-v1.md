# SOPHIA Reasoning API v1

## Authentication

`POST /api/v1/verify` uses API key authentication:

- Header: `Authorization: Bearer sk-sophia-...`
- Keys are created by admins via `POST /api/v1/keys`
- Keys are stored hashed in Firestore `api_keys/{keyId}`

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

Response headers:

- `X-Request-Id`
- `X-Processing-Time-Ms`
- `X-Token-Usage` (JSON mode)

Response payload includes:

- `extracted_claims`
- `logical_relations`
- `reasoning_quality` (`overall_score` + 6 dimensions, each scored `0..1`)

### `POST /api/v1/keys`

Admin-only (Firebase-authenticated). Generates an API key.

Body:

```json
{
  "name": "My integration",
  "owner_uid": "firebase_uid",
  "daily_quota": 100
}
```

Returns raw key once (`api_key`).

### `GET /api/v1/keys`

Admin-only. Lists keys.

Optional query param:

- `owner_uid`

### `DELETE /api/v1/keys`

Admin-only. Revokes key.

Use `key_id` as query param or JSON body.

## Waitlist

- `GET /api-access`
- `GET /developer` (redirect)

Submits to Firestore `waitlist/{autoId}`.
