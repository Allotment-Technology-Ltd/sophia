import type { PageServerLoad } from './$types';
import { env as publicEnv } from '$env/dynamic/public';
import { resolvePaddleRuntime, type PaddleRuntime } from '$lib/server/billing/runtime';

function isClientTokenCompatible(runtime: PaddleRuntime, token: string): boolean {
  const value = token.trim();
  if (!value) return false;
  if (runtime === 'production' && value.startsWith('test_')) return false;
  if (runtime === 'sandbox' && value.startsWith('live_')) return false;
  return true;
}

function resolveClientToken(runtime: PaddleRuntime): string | null {
  const runtimeCandidate =
    runtime === 'sandbox'
      ? publicEnv.PUBLIC_PADDLE_CLIENT_TOKEN_SANDBOX?.trim()
      : publicEnv.PUBLIC_PADDLE_CLIENT_TOKEN_PRODUCTION?.trim();
  if (runtimeCandidate && isClientTokenCompatible(runtime, runtimeCandidate)) {
    return runtimeCandidate;
  }

  const generic = publicEnv.PUBLIC_PADDLE_CLIENT_TOKEN?.trim();
  if (generic && isClientTokenCompatible(runtime, generic)) {
    return generic;
  }
  return null;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function resolveCheckoutTheme(): 'light' | 'dark' | null {
  const raw = publicEnv.PUBLIC_PADDLE_CHECKOUT_THEME?.trim().toLowerCase();
  if (raw === 'light' || raw === 'dark') return raw;
  // Keep checkout visuals aligned with app branding by default.
  return 'dark';
}

function resolveCheckoutVariant(): 'one-page' | 'multi-page' | null {
  const raw = publicEnv.PUBLIC_PADDLE_CHECKOUT_VARIANT?.trim().toLowerCase();
  if (raw === 'one-page' || raw === 'multi-page') return raw;
  return null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const runtime = resolvePaddleRuntime({ requestUrl: url.toString() });
  return {
    paddleRuntime: runtime,
    paddleClientToken: resolveClientToken(runtime),
    isAuthenticated: Boolean(locals.user?.uid),
    checkoutSettings: {
      locale: publicEnv.PUBLIC_PADDLE_CHECKOUT_LOCALE?.trim() || null,
      theme: resolveCheckoutTheme(),
      variant: resolveCheckoutVariant(),
      allowLogout: parseBooleanEnv(publicEnv.PUBLIC_PADDLE_CHECKOUT_ALLOW_LOGOUT, false),
      showAddTaxId: parseBooleanEnv(publicEnv.PUBLIC_PADDLE_CHECKOUT_SHOW_ADD_TAX_ID, false)
    }
  };
};
