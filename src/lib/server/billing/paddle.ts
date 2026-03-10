import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeCurrency, type BillingTier, type CurrencyCode } from './types';

type CheckoutKind = 'subscription' | 'topup_small' | 'topup_large';
type PaddleRuntime = 'sandbox' | 'production';

interface PaddleApiResponse<T> {
  data?: T;
  error?: { code?: string; detail?: string; message?: string };
  meta?: Record<string, unknown>;
}

interface PaddleTransaction {
  id: string;
  status?: string;
  customer_id?: string | null;
  subscription_id?: string | null;
  custom_data?: Record<string, unknown>;
  details?: {
    totals?: {
      total?: string;
      currency_code?: string;
    };
  };
  checkout?: {
    url?: string;
  };
}

interface PaddleTransactionsListResponse {
  data?: PaddleTransaction[];
}

interface PaddlePortalSession {
  urls?: {
    general?: {
      overview?: string;
    };
  };
}

function isLocalhostAppUrl(appUrl: string): boolean {
  try {
    const parsed = new URL(appUrl);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isProductionNodeRuntime(): boolean {
  return (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

function resolvePaddleRuntime(): PaddleRuntime {
  const explicit = (process.env.PADDLE_RUNTIME ?? '').trim().toLowerCase();
  if (explicit === 'sandbox') return 'sandbox';
  if (explicit === 'production') return 'production';
  return isProductionNodeRuntime() ? 'production' : 'sandbox';
}

function runtimeEnvCandidates(base: string, runtime: PaddleRuntime): string[] {
  if (runtime === 'sandbox') return [`${base}_SANDBOX`, base];
  return [`${base}_PRODUCTION`, base];
}

function requireRuntimeEnv(base: string): string {
  const runtime = resolvePaddleRuntime();
  for (const key of runtimeEnvCandidates(base, runtime)) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error(
    `${runtimeEnvCandidates(base, runtime).join(' or ')} is not configured for ${runtime} runtime`
  );
}

function optionalRuntimeEnv(base: string): string | null {
  const runtime = resolvePaddleRuntime();
  for (const key of runtimeEnvCandidates(base, runtime)) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function paddleApiBase(): string {
  return resolvePaddleRuntime() === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';
}

function paddleAuthHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireRuntimeEnv('PADDLE_API_KEY')}`,
    'Content-Type': 'application/json'
  };
}

function tierPriceEnvKey(tier: BillingTier, currency: CurrencyCode): string {
  const suffix = currency === 'USD' ? 'USD' : 'GBP';
  if (tier === 'pro') return `PADDLE_PRICE_PRO_${suffix}`;
  if (tier === 'premium') return `PADDLE_PRICE_PREMIUM_${suffix}`;
  throw new Error(`Tier ${tier} does not have a subscription price`);
}

function topupPriceEnvKey(kind: CheckoutKind, currency: CurrencyCode): string {
  const suffix = currency === 'USD' ? 'USD' : 'GBP';
  if (kind === 'topup_small') return `PADDLE_PRICE_TOPUP_SMALL_${suffix}`;
  if (kind === 'topup_large') return `PADDLE_PRICE_TOPUP_LARGE_${suffix}`;
  throw new Error(`Checkout kind ${kind} is not a top-up price`);
}

function parseCheckoutUrl(payload: PaddleApiResponse<PaddleTransaction>): string {
  const url = payload?.data?.checkout?.url;
  if (!url) {
    const detail = payload?.error?.detail ?? payload?.error?.message ?? 'Unknown Paddle error';
    throw new Error(`Paddle checkout URL missing: ${detail}`);
  }
  return url;
}

async function paddlePost<T>(path: string, body: Record<string, unknown>): Promise<PaddleApiResponse<T>> {
  const response = await fetch(`${paddleApiBase()}${path}`, {
    method: 'POST',
    headers: paddleAuthHeaders(),
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => ({}))) as PaddleApiResponse<T>;
  if (!response.ok) {
    const detail = payload?.error?.detail ?? payload?.error?.message ?? response.statusText;
    throw new Error(`Paddle API error (${response.status}): ${detail}`);
  }
  return payload;
}

async function paddleGet<T>(path: string): Promise<PaddleApiResponse<T>> {
  const response = await fetch(`${paddleApiBase()}${path}`, {
    method: 'GET',
    headers: paddleAuthHeaders()
  });
  const payload = (await response.json().catch(() => ({}))) as PaddleApiResponse<T>;
  if (!response.ok) {
    const detail = payload?.error?.detail ?? payload?.error?.message ?? response.statusText;
    throw new Error(`Paddle API error (${response.status}): ${detail}`);
  }
  return payload;
}

export async function createSubscriptionCheckout(params: {
  uid: string;
  email?: string | null;
  tier: Extract<BillingTier, 'pro' | 'premium'>;
  currency: CurrencyCode;
  appUrl?: string | null;
  legalTermsVersion?: string;
  legalPrivacyVersion?: string;
}): Promise<{ checkoutUrl: string; priceId: string }> {
  const appUrl =
    params.appUrl?.trim() ||
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.PUBLIC_BASE_URL?.trim() ||
    '';
  const successUrl = appUrl ? `${appUrl}/?billing=success` : undefined;
  const cancelUrl = appUrl ? `${appUrl}/?billing=cancelled` : undefined;
  const checkoutPageUrl =
    appUrl && !isLocalhostAppUrl(appUrl) ? `${appUrl.replace(/\/+$/, '')}/pricing` : undefined;
  const priceId = requireRuntimeEnv(tierPriceEnvKey(params.tier, params.currency));

  const payload = await paddlePost<PaddleTransaction>('/transactions', {
    items: [{ price_id: priceId, quantity: 1 }],
    customer_email: params.email ?? undefined,
    custom_data: {
      uid: params.uid,
      purchase_kind: 'subscription',
      tier: params.tier,
      currency: params.currency,
      legal_terms_version: params.legalTermsVersion ?? null,
      legal_privacy_version: params.legalPrivacyVersion ?? null
    },
    checkout: {
      ...(checkoutPageUrl ? { url: checkoutPageUrl } : {}),
      success_url: successUrl,
      cancel_url: cancelUrl
    }
  });

  return {
    checkoutUrl: parseCheckoutUrl(payload),
    priceId
  };
}

export async function createTopupCheckout(params: {
  uid: string;
  email?: string | null;
  currency: CurrencyCode;
  pack: 'small' | 'large';
  appUrl?: string | null;
}): Promise<{ checkoutUrl: string; priceId: string; topupCents: number }> {
  const appUrl =
    params.appUrl?.trim() ||
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.PUBLIC_BASE_URL?.trim() ||
    '';
  const successUrl = appUrl ? `${appUrl}/?billing=topup_success` : undefined;
  const cancelUrl = appUrl ? `${appUrl}/?billing=topup_cancelled` : undefined;
  const checkoutPageUrl =
    appUrl && !isLocalhostAppUrl(appUrl) ? `${appUrl.replace(/\/+$/, '')}/pricing` : undefined;
  const kind: CheckoutKind = params.pack === 'large' ? 'topup_large' : 'topup_small';
  const priceId = requireRuntimeEnv(topupPriceEnvKey(kind, params.currency));
  const topupCents =
    params.pack === 'large'
      ? Number.parseInt(process.env.BYOK_TOPUP_LARGE_CENTS ?? '1500', 10) || 1500
      : Number.parseInt(process.env.BYOK_TOPUP_SMALL_CENTS ?? '500', 10) || 500;

  const payload = await paddlePost<PaddleTransaction>('/transactions', {
    items: [{ price_id: priceId, quantity: 1 }],
    customer_email: params.email ?? undefined,
    custom_data: {
      uid: params.uid,
      purchase_kind: 'topup',
      topup_pack: params.pack,
      topup_cents: topupCents,
      currency: params.currency
    },
    checkout: {
      ...(checkoutPageUrl ? { url: checkoutPageUrl } : {}),
      success_url: successUrl,
      cancel_url: cancelUrl
    }
  });

  return {
    checkoutUrl: parseCheckoutUrl(payload),
    priceId,
    topupCents
  };
}

export async function createCustomerPortalSession(params: {
  paddleCustomerId: string;
}): Promise<string> {
  const payload = await paddlePost<PaddlePortalSession>(
    `/customers/${params.paddleCustomerId}/portal-sessions`,
    {}
  );
  const url = payload.data?.urls?.general?.overview;
  if (!url) throw new Error('Paddle portal session URL missing from response');
  return url;
}

export async function listRecentTransactions(limit = 50): Promise<PaddleTransaction[]> {
  const perPage = Math.min(100, Math.max(1, Math.floor(limit)));
  const payload = await paddleGet<PaddleTransactionsListResponse>(`/transactions?per_page=${perPage}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

function parsePaddleSignatureHeader(signatureHeader: string): { ts: string; h1: string } | null {
  const tokens = signatureHeader.split(';').map((part) => part.trim());
  let ts = '';
  let h1 = '';
  for (const token of tokens) {
    const [k, v] = token.split('=');
    if (k === 'ts' && v) ts = v;
    if (k === 'h1' && v) h1 = v;
  }
  if (!ts || !h1) return null;
  return { ts, h1 };
}

export function verifyPaddleWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = optionalRuntimeEnv('PADDLE_WEBHOOK_SECRET');
  if (!secret) {
    return (process.env.PADDLE_ALLOW_UNSIGNED_WEBHOOKS ?? 'false').toLowerCase() === 'true';
  }
  if (!signatureHeader) return false;

  const parsed = parsePaddleSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const signedPayload = `${parsed.ts}:${rawBody}`;
  const digest = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  const incoming = Buffer.from(parsed.h1, 'hex');
  const expected = Buffer.from(digest, 'hex');
  if (incoming.length !== expected.length) return false;
  return timingSafeEqual(incoming, expected);
}

export interface PaddleWebhookEvent {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: Record<string, unknown>;
}

export function parsePaddleWebhook(rawBody: string): PaddleWebhookEvent {
  const parsed = JSON.parse(rawBody) as PaddleWebhookEvent;
  return {
    event_id: typeof parsed.event_id === 'string' ? parsed.event_id : undefined,
    event_type: typeof parsed.event_type === 'string' ? parsed.event_type : undefined,
    occurred_at: typeof parsed.occurred_at === 'string' ? parsed.occurred_at : undefined,
    data: parsed.data && typeof parsed.data === 'object' ? parsed.data : {}
  };
}

export function mapWebhookCurrency(data: Record<string, unknown>): CurrencyCode {
  return normalizeCurrency(
    data.currency_code ??
      (data.custom_data as Record<string, unknown> | undefined)?.currency ??
      'GBP'
  );
}
