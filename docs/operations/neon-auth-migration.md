# Neon Auth (current default)

Sophia uses **Neon Auth JWTs only** for Bearer verification on protected `/api/*` routes (`src/lib/server/bearerAuthVerification.ts`, `src/lib/server/neon/neonAuthJwt.ts`). There is no Firebase ID token path.

## Required environment variables (every environment)

| Variable | Where | Purpose |
|----------|--------|---------|
| `DATABASE_URL` | Runtime | Neon Postgres; required for `sophiaDocumentsDb` when `SOPHIA_DATA_BACKEND=neon` (default). |
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

## Google still shows “Continue to …firebaseapp.com”

That text comes from **Google’s OAuth consent / client configuration**, not from the old Firebase Web SDK in Sophia (the bundle does not call Firebase for sign-in).

Typical cause: **Neon Auth → Google** is configured with the **Firebase project’s Web client ID** (from Firebase Console), so Google labels the flow with `your-project.firebaseapp.com`.

**What to do**

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (same or new GCP project), create an **OAuth 2.0 Client ID** of type **Web application** intended for Neon — **not** the “Web client” auto-created under Firebase’s project settings if you want to drop the Firebase hostname from the prompt.
2. In the client, set **Authorized redirect URIs** to the callback URL Neon expects for your branch (Neon Console → project → **Auth** / provider setup usually lists this; see [Neon: Set up OAuth](https://neon.com/docs/auth/guides/setup-oauth)).
3. In **Neon Console** → your project → **Auth** → **Google**, set **Client ID** and **Client secret** to that new OAuth client (not the Firebase Web client).
4. Optional: [OAuth consent screen](https://console.cloud.google.com/auth/branding) — set app name and **Authorized domains** (e.g. `usesophia.app`) so users see your product instead of a generic domain (Neon’s docs also cover [Google OAuth branding](https://neon.com/docs/auth/guides/setup-oauth#google-oauth-branding)).

After that, redeploy the frontend only if you changed env; changing Neon/Google credentials does not require a new app build.

## Identity and `users/{uid}` documents

- JWT **`sub`** is the canonical user id for new `users/{sub}` rows in `sophia_documents`.
- **`OWNER_EMAILS`**: owner capability by **normalized email** (still works across id changes).
- **`syncAuthenticatedUserRole`** can merge **roles** from other `users/*` docs that share the same email (helps after migrating from Firebase-era ids). It does **not** move BYOK subcollections automatically.

## `OWNER_UIDS` and `ADMIN_UIDS` (Neon `sub`)

- Use **comma-separated Neon Auth user ids** — the JWT claim **`sub`**, not email and not legacy Firebase UIDs.
- **`ADMIN_UIDS`**: identities allowed for admin-only APIs (e.g. service accounts that mint JWTs with a fixed `sub`).
- **`OWNER_UIDS`**: first id is the primary **operator BYOK** document path: `users/{sub}/byokProviders`. After cutover, **replace** old Firebase UIDs in Secret Manager / env with each operator’s Neon `sub`, or re-save BYOK under the new `users/{sub}` path. **Owners** (seeded email, JWT `owner` role, or uid listed in `OWNER_UIDS`) hit that same path from **Settings → BYOK** (`/api/byok/*`), so it stays aligned with **Admin → Operator BYOK**.
- If someone signs in with Neon and already had a Firebase-era row, **email-based role merge** may restore `owner`/`user` roles on the new `users/{sub}` doc, but **operator keys** still live under whatever `sub` `OWNER_UIDS` points at — update `OWNER_UIDS` to match.

## Production (GitHub Actions → Cloud Run)

1. Repository secret **`NEON_AUTH_BASE_URL`** — **required.** Used for the Docker **`VITE_NEON_AUTH_URL`** build arg (client bundle) **and** must match what you set on Cloud Run as **`NEON_AUTH_BASE_URL`**. If this secret is missing or empty, the image still builds in older workflows; the **auth page breaks** with “Neon Auth is not configured. Set `VITE_NEON_AUTH_URL`.” The deploy workflow now **fails the Docker build** when the secret is unset. Add it under **GitHub → repo → Settings → Secrets and variables → Actions**.
2. Secret Manager **`neon-database-url`** → **`DATABASE_URL`** on Cloud Run.
3. Update secrets **`admin-uids`** / **`owner-uids`** to Neon **`sub`** values as above.

## JWT lifetime

Neon access tokens are short-lived; the client should refresh via the Neon auth client before calling APIs.
