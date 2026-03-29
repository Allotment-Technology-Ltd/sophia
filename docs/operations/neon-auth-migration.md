# Neon Auth migration (checklist)

Sophia verifies **Firebase ID tokens** first, then **Neon Auth JWTs** when `USE_NEON_AUTH=1` (`src/lib/server/bearerAuthVerification.ts`, `src/lib/server/neon/neonAuthJwt.ts`).

## 1. Enable Neon Auth on the branch

In the [Neon Console](https://console.neon.tech), open your project → **Auth**, or use the [Neon API](https://neon.com/docs/auth/guides/manage-auth-api):

`GET https://console.neon.tech/api/v2/projects/{project_id}/branches/{branch_id}/auth`

The response includes **`base_url`** and **`jwks_url`**. Auth is branch-scoped; preview branches can differ from production.

## 2. Sophia environment variables

**Recommended (single variable):**

- `USE_NEON_AUTH=1`
- `NEON_AUTH_BASE_URL=<base_url from API or console>`  
  Example shape: `https://….neonauth….neon.tech/neondb/auth`

Sophia sets:

- JWKS URL → `{BASE_URL}/.well-known/jwks.json` (unless you override `NEON_AUTH_JWKS_URL`)
- Issuer → origin of that URL (JWT `iss` per [Neon JWT guide](https://neon.com/docs/auth/guides/plugins/jwt))
- Audience → same origin (JWT `aud` in Neon’s default tokens)

**Explicit mode** (no base URL): set `NEON_AUTH_ISSUER` and `NEON_AUTH_JWKS_URL`, and optionally `NEON_AUTH_AUDIENCE`.

## 3. Print env lines from the API

Create a Neon **API key** (Account → API keys). Then either set `NEON_PROJECT_ID`, `NEON_BRANCH_ID`, and run:

```bash
pnpm neon:auth-env
```

Or pass ids after `--`:

```bash
pnpm neon:auth-env -- <project_id> <branch_id>
```

Paste the printed lines into `.env` / Cloud Run secrets (do not commit secrets).

**Cursor:** the Neon MCP can list projects/branches (`list_projects`, `describe_project`) but does not return `base_url`; use the script above or a one-off `curl` with `NEON_API_KEY`.

## 4. Client tokens

Neon Auth normally uses HTTP-only cookies. For `/api/*` Bearer auth, obtain a JWT via the Neon SDK (`authClient.token()` or session response header `set-auth-jwt`) as described in the [JWT plugin doc](https://neon.com/docs/auth/guides/plugins/jwt). Wire that into your Svelte app’s `Authorization` header (Sophia’s Firebase `getIdToken()` path remains for dual migration).

## 5. Identity mapping

Map stable JWT `sub` to `users/{uid}` in your datastore (`syncAuthenticatedUserRole` uses `sub` as the document id). Plan user migration from Firebase `uid` to Neon `sub` if ids change.

## Rollout

- Server verifies **Neon JWT first** when `USE_NEON_AUTH=1`, then Firebase for legacy tokens.
- Refresh JWTs before expiry (Neon access tokens are short-lived, ~15 minutes per docs).
- Configure **trusted domains** and Google OAuth in Neon Auth for your production hostname (and `http://localhost:5173` for local dev).

## Production (GitHub Actions → Cloud Run)

Add repository secret **`NEON_AUTH_BASE_URL`** with the same value as local `NEON_AUTH_BASE_URL` / `VITE_NEON_AUTH_URL` (Neon branch auth base URL ending in `/…/auth`). The deploy workflow passes it into the Docker build as `VITE_NEON_AUTH_URL` and into Cloud Run as `NEON_AUTH_BASE_URL`, with `USE_NEON_AUTH=1`.

## Post-cutover operations

- **`OWNER_UIDS`** / operator BYOK paths use Firebase UIDs today. After cutover, update `OWNER_UIDS` (and any docs keyed by old `users/{firebaseUid}`) to Neon Auth user ids (`sub`) where needed.
- **Subcollections** under `users/{firebaseUid}` (e.g. BYOK) are **not** moved automatically; merge by email only lifts **roles** on the app user row. Plan a data migration or re-link BYOK for power users if required.
