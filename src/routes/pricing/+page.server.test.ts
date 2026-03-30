import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/billing/runtime', () => ({
  resolvePaddleRuntime: () => 'production'
}));

vi.mock('$env/dynamic/public', () => ({
  env: {
    PUBLIC_PADDLE_CLIENT_TOKEN_PRODUCTION: 'live_token_x',
    PUBLIC_PADDLE_CLIENT_TOKEN: '',
    PUBLIC_PADDLE_CHECKOUT_THEME: 'dark',
    PUBLIC_PADDLE_CHECKOUT_VARIANT: 'one-page',
    PUBLIC_PADDLE_CHECKOUT_ALLOW_LOGOUT: 'false',
    PUBLIC_PADDLE_CHECKOUT_SHOW_ADD_TAX_ID: 'false',
    PUBLIC_PADDLE_CHECKOUT_LOCALE: 'en'
  }
}));

import { load } from './+page.server';

describe('pricing page server load', () => {
  it('exposes pro monthly price ids with backward-compatible fallback', async () => {
    process.env.PADDLE_PRICE_KEYS_PRO_MONTHLY_GBP_PRODUCTION = 'pri_pro_gbp';
    process.env.PADDLE_PRICE_PREMIUM_USD_PRODUCTION = 'pri_fallback_usd';
    delete process.env.PADDLE_PRICE_KEYS_PRO_MONTHLY_USD_PRODUCTION;

    const data = await load({
      locals: { user: { uid: 'u1' } },
      url: new URL('https://example.com/pricing')
    } as never);

    expect(data.proMonthlyPriceIds.GBP).toBe('pri_pro_gbp');
    expect(data.proMonthlyPriceIds.USD).toBe('pri_fallback_usd');
  });
});
