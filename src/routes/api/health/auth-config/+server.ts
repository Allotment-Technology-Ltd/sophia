import { json, error, type RequestHandler } from '@sveltejs/kit';
import { isNeonAuthEnabled, resolveNeonAuthVerificationConfig } from '$lib/server/neon/neonAuthJwt';

/**
 * Public ops probe: whether Neon Auth verification is configured (no secrets).
 * GET /api/health/auth-config
 */
export const GET: RequestHandler = () => {
  if (!isNeonAuthEnabled()) {
    return json({ use_neon_auth: false });
  }
  try {
    const t = resolveNeonAuthVerificationConfig();
    let jwksHost: string | null = null;
    try {
      jwksHost = new URL(t.jwksUrl).host;
    } catch {
      jwksHost = null;
    }
    return json({
      use_neon_auth: true,
      jwks_host: jwksHost,
      trusted_issuer_count: t.trustedIssuers.length,
      trusted_audience_count: t.trustedAudiences.length,
      clock_skew_seconds:
        typeof t.clockTolerance === 'number' ? t.clockTolerance : String(t.clockTolerance)
    });
  } catch (e) {
    throw error(500, e instanceof Error ? e.message : 'Neon Auth not configured');
  }
};
