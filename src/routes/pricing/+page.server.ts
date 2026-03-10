import type { PageServerLoad } from './$types';
import { env as publicEnv } from '$env/dynamic/public';

type PaddleRuntime = 'sandbox' | 'production';

function resolveRuntime(): PaddleRuntime {
  const explicit = (process.env.PADDLE_RUNTIME ?? '').trim().toLowerCase();
  if (explicit === 'sandbox') return 'sandbox';
  if (explicit === 'production') return 'production';
  return (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
}

function resolveClientToken(runtime: PaddleRuntime): string | null {
  if (runtime === 'sandbox') {
    return (
      publicEnv.PUBLIC_PADDLE_CLIENT_TOKEN_SANDBOX?.trim() ||
      publicEnv.PUBLIC_PADDLE_CLIENT_TOKEN?.trim() ||
      null
    );
  }
  return (
    publicEnv.PUBLIC_PADDLE_CLIENT_TOKEN_PRODUCTION?.trim() ||
    publicEnv.PUBLIC_PADDLE_CLIENT_TOKEN?.trim() ||
    null
  );
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
  return null;
}

function resolveCheckoutVariant(): 'one-page' | 'multi-page' | null {
  const raw = publicEnv.PUBLIC_PADDLE_CHECKOUT_VARIANT?.trim().toLowerCase();
  if (raw === 'one-page' || raw === 'multi-page') return raw;
  return null;
}

export const load: PageServerLoad = async ({ locals }) => {
  const runtime = resolveRuntime();
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
