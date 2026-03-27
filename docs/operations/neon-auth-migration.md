# Neon Auth migration (checklist)

Sophia today verifies **Firebase ID tokens** server-side (`firebase-admin`) and stores operational data in Firestore (or Neon when `SOPHIA_DATA_BACKEND=neon`).

## Target architecture

1. **Provision Neon Auth** (or Stack Auth linked to Neon) in the Neon console for your project.
2. **Issue JWTs** from the Neon Auth hosted UI / SDK instead of Firebase client SDK.
3. **Server verification**: replace `firebase-admin` ID token verification with JWT verification against Neon Auth’s JWKS (issuer + audience from Neon docs).
4. **Identity mapping**: map stable `sub` (Neon user id) to existing `users/*` documents during migration, or re-key `sophia_documents` paths from Firebase `uid` to Neon `sub`.
5. **Client**: swap Firebase client init for Neon Auth / Stack client; keep session cookies or bearer flow aligned with SvelteKit `locals`.

## Env vars (illustrative)

- `NEON_AUTH_ISSUER`
- `NEON_AUTH_JWKS_URL` or embedded JWKS
- `NEON_AUTH_AUDIENCE`

Exact names depend on the Neon Auth product version — confirm in the Neon console when enabling Auth.

## Rollout

- Run **dual verification** (accept Firebase or Neon JWT) during migration.
- Freeze new Firebase sign-ups before final cutover.
- Update `OWNER_EMAILS` / admin allowlists to use Neon identities if the subject changes.

This file is planning guidance; implementation lands in `hooks.server.ts`, API guards, and client auth modules when you execute the migration.
