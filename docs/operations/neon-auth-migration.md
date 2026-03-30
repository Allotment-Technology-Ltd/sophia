# Neon Auth (current default)

Sophia uses **Neon Auth JWTs only** for Bearer verification on protected `/api/*` routes (`src/lib/server/bearerAuthVerification.ts`, `src/lib/server/neon/neonAuthJwt.ts`). There is no Firebase ID token path.

## Required environment variables (every environment)

| Variable | Where | Purpose |
|----------|--------|---------|
| `DATABASE_URL` | Runtime | Neon Postgres; required for `adminDb` when `SOPHIA_DATA_BACKEND=neon` (default). |
| `USE_NEON_AUTH` | Runtime | Must be `1` / `true` / `yes` so APIs verify Neon JWTs. |
| `NEON_AUTH_BASE_URL` | Runtime | Branch auth `base_url` from Neon (ends with `/…/auth`). Derives JWKS, issuer, audience per [Neon JWT guide](https://neon.com/docs/auth/guides/plugins/jwt). |
| `VITE_NEON_AUTH_URL` | **Build** (Vite) | Same URL as `NEON_AUTH_BASE_URL` for the browser auth client (`src/lib/authClient.ts`). |

**Explicit mode** (no base URL): set `NEON_AUTH_ISSUER` and `NEON_AUTH_JWKS_URL`, and optionally `NEON_AUTH_AUDIENCE`.

## Print server env lines

```bash
pnpm neon:auth-env
# or: pnpm neon:auth-env -- <project_id> <branch_id>
```

Needs `NEON_API_KEY` (Account → API keys) and project/branch ids.

## Client sessions

The app uses `@neondatabase/neon-js` with `VITE_NEON_AUTH_URL`. API calls send `Authorization: Bearer <access_token>` from `getSession()` (`src/lib/authClient.ts`).

## Identity and `users/{uid}` documents

- JWT **`sub`** is the canonical user id for new `users/{sub}` rows in `sophia_documents`.
- **`OWNER_EMAILS`**: owner capability by **normalized email** (still works across id changes).
- **`syncAuthenticatedUserRole`** can merge **roles** from other `users/*` docs that share the same email (helps after migrating from Firebase-era ids). It does **not** move BYOK subcollections automatically.

## `OWNER_UIDS` and `ADMIN_UIDS` (Neon `sub`)

- Use **comma-separated Neon Auth user ids** — the JWT claim **`sub`**, not email and not legacy Firebase UIDs.
- **`ADMIN_UIDS`**: identities allowed for admin-only APIs (e.g. service accounts that mint JWTs with a fixed `sub`).
- **`OWNER_UIDS`**: first id is the primary **operator BYOK** document path: `users/{sub}/byokProviders`. After cutover, **replace** old Firebase UIDs in Secret Manager / env with each operator’s Neon `sub`, or re-save BYOK under the new `users/{sub}` path.
- If someone signs in with Neon and already had a Firebase-era row, **email-based role merge** may restore `owner`/`user` roles on the new `users/{sub}` doc, but **operator keys** still live under whatever `sub` `OWNER_UIDS` points at — update `OWNER_UIDS` to match.

## Production (GitHub Actions → Cloud Run)

1. Repository secret **`NEON_AUTH_BASE_URL`** — used for the Docker **`VITE_NEON_AUTH_URL`** build arg and for Cloud Run **`NEON_AUTH_BASE_URL`** with **`USE_NEON_AUTH=1`** (see `.github/workflows/deploy.yml`).
2. Secret Manager **`neon-database-url`** → **`DATABASE_URL`** on Cloud Run.
3. Update secrets **`admin-uids`** / **`owner-uids`** to Neon **`sub`** values as above.

## JWT lifetime

Neon access tokens are short-lived; the client should refresh via the Neon auth client before calling APIs.
