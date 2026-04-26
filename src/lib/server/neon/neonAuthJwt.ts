/**
 * Neon Auth (Better Auth) JWT verification for protected API routes.
 *
 * - **Default:** `USE_NEON_AUTH=1` + `NEON_AUTH_BASE_URL` or `NEON_AUTH_URL` (Neon `base_url` ending in `/.../auth`).
 *   The server verifies the JWS with JWKS, then checks `iss` (and `aud` when present) against a **trust set**
 *   that includes the auth host **origin** and the full **base URL** so minor issuer/audience differences
 *   between Neon and Better Auth are tolerated.
 * - **Overrides:** `NEON_AUTH_TRUSTED_ISSUERS` / `NEON_AUTH_TRUSTED_AUDIENCES` (comma/semicolon-separated) merge
 *   into the trust set. `NEON_AUTH_JWT_CLOCK_TOLERANCE` (seconds) defaults to 60 to reduce 401s from clock skew.
 * - **Explicit mode:** `NEON_AUTH_ISSUER` + `NEON_AUTH_JWKS_URL` (optional `NEON_AUTH_AUDIENCE` + trust lists as above).
 *
 * If a JWT has **no** `aud` claim, we do not require one (Supabase-style “authenticated” tokens may omit it).
 *
 * `pnpm neon:auth-env` prints canonical values from the Neon API.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwksForUrl(url: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksByUrl.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksByUrl.set(url, jwks);
  }
  return jwks;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function isNeonAuthEnabled(): boolean {
  const v = (process.env.USE_NEON_AUTH ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function neonAuthBaseFromEnv(): string | undefined {
  return (
    process.env.NEON_AUTH_BASE_URL?.trim() ||
    process.env.NEON_AUTH_URL?.trim() ||
    undefined
  );
}

function readClockTolerance(): string | number {
  const raw = process.env.NEON_AUTH_JWT_CLOCK_TOLERANCE?.trim();
  if (!raw) return 60;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return raw;
}

function payloadIss(payload: JWTPayload): string | null {
  const i = payload.iss;
  return typeof i === 'string' && i.length > 0 ? i : null;
}

function normalizeAudClaim(aud: unknown): string[] {
  if (aud == null) return [];
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud)) {
    return aud.filter((a): a is string => typeof a === 'string');
  }
  return [];
}

/**
 * Resolves JWKS + trusted `iss` / `aud` values. Signature verification only uses `jwksUrl` + `clockTolerance`.
 */
export interface NeonAuthClaimTrust {
  jwksUrl: string;
  /** Passed to jose (seconds or string, e.g. "60s"). */
  clockTolerance: string | number;
  /** If non-empty, `iss` claim (when present) must match one of these. */
  trustedIssuers: string[];
  /** If the token has `aud` and this is non-empty, at least one aud must be listed. If token has no `aud`, no check. */
  trustedAudiences: string[];
}

function buildTrustFromBase(params: { base: string; explicitIssuer?: string; explicitJwks?: string; explicitAudience?: string }): NeonAuthClaimTrust {
  const { base, explicitIssuer, explicitJwks, explicitAudience } = params;
  const trimmed = base.replace(/\/$/, '');
  let origin: string;
  try {
    origin = new URL(trimmed).origin;
  } catch {
    throw new Error('NEON_AUTH_BASE_URL (or NEON_AUTH_URL) is not a valid URL');
  }
  const jwksUrl = explicitJwks || `${trimmed}/.well-known/jwks.json`;
  const fromEnvExtraIss = parseList(process.env.NEON_AUTH_TRUSTED_ISSUERS);
  const fromEnvExtraAud = parseList(process.env.NEON_AUTH_TRUSTED_AUDIENCES);

  const trustedIssuers = uniqueStrings(
    [explicitIssuer, origin, trimmed, ...fromEnvExtraIss].filter((s): s is string => Boolean(s && s.length > 0))
  );
  const trustedAudiences = uniqueStrings(
    [explicitAudience, origin, trimmed, ...fromEnvExtraAud].filter(
      (s): s is string => Boolean(s && s.length > 0)
    )
  );

  return {
    jwksUrl,
    clockTolerance: readClockTolerance(),
    trustedIssuers,
    trustedAudiences
  };
}

/**
 * @throws If Neon auth is enabled but configuration is incomplete.
 * @internal Export for unit tests
 */
export function resolveNeonAuthVerificationConfig(): NeonAuthClaimTrust {
  const base = neonAuthBaseFromEnv();
  const explicitIssuer = process.env.NEON_AUTH_ISSUER?.trim();
  const explicitJwks = process.env.NEON_AUTH_JWKS_URL?.trim();
  const explicitAudience = process.env.NEON_AUTH_AUDIENCE?.trim();
  const fromEnvExtraIss = parseList(process.env.NEON_AUTH_TRUSTED_ISSUERS);
  const fromEnvExtraAud = parseList(process.env.NEON_AUTH_TRUSTED_AUDIENCES);

  if (base) {
    return buildTrustFromBase({ base, explicitIssuer, explicitJwks, explicitAudience });
  }

  if (explicitIssuer && explicitJwks) {
    return {
      jwksUrl: explicitJwks,
      clockTolerance: readClockTolerance(),
      trustedIssuers: uniqueStrings([explicitIssuer, ...fromEnvExtraIss]),
      trustedAudiences: uniqueStrings(
        [explicitAudience, explicitIssuer, ...fromEnvExtraAud].filter(
          (s): s is string => Boolean(s && s.length > 0)
        )
      )
    };
  }

  throw new Error(
    'USE_NEON_AUTH is set but auth is not configured: set NEON_AUTH_BASE_URL or NEON_AUTH_URL (from Neon API `base_url`) or both NEON_AUTH_ISSUER and NEON_AUTH_JWKS_URL'
  );
}

function assertIssTrusted(payload: JWTPayload, trustedIssuers: string[]): void {
  if (trustedIssuers.length === 0) return;
  const iss = payloadIss(payload);
  if (iss == null) {
    throw new Error('JWT missing iss (issuer trust list is set)');
  }
  if (!trustedIssuers.includes(iss)) {
    throw new Error(
      `JWT issuer not trusted: iss=${iss.slice(0, 80)}. Expected one of: ${trustedIssuers.join(', ')}`
    );
  }
}

function assertAudTrusted(payload: JWTPayload, trustedAudiences: string[]): void {
  const auds = normalizeAudClaim(payload.aud);
  if (auds.length === 0) return;
  if (trustedAudiences.length === 0) {
    // Token has aud but we have no trust list: accept (avoid breaking unusual Neon configs).
    return;
  }
  if (!auds.some((a) => trustedAudiences.includes(a))) {
    throw new Error(
      `JWT aud not trusted: [${auds.map((a) => a.slice(0, 48)).join(', ')}]. Expected one of: ${trustedAudiences.join(', ')}`
    );
  }
}

export interface NeonAuthUserClaims {
  sub: string;
  email?: string;
  raw: JWTPayload;
}

/**
 * Verifies a Bearer JWT against Neon Auth JWKS, then enforces `iss`/`aud` trust. Returns null if Neon auth is disabled.
 */
export async function verifyNeonAuthJwt(token: string): Promise<NeonAuthUserClaims | null> {
  if (!isNeonAuthEnabled()) return null;
  const trust = resolveNeonAuthVerificationConfig();
  const { payload } = await jwtVerify(token, getJwksForUrl(trust.jwksUrl), { clockTolerance: trust.clockTolerance });
  assertIssTrusted(payload, trust.trustedIssuers);
  assertAudTrusted(payload, trust.trustedAudiences);
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  if (!sub) throw new Error('Neon Auth JWT missing sub');
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  return { sub, email, raw: payload };
}
