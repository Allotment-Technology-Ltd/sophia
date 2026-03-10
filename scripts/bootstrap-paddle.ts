/**
 * SOPHIA — Paddle Bootstrap Helper
 *
 * Creates (or reuses) Paddle products, prices, and webhook destination for SOPHIA billing.
 * Prints an env block with the generated price IDs and webhook secret.
 *
 * Usage:
 *   npm run billing:paddle:bootstrap
 *   npm run billing:paddle:bootstrap -- --dry-run
 *   npm run billing:paddle:bootstrap -- --write-env=.env.paddle.generated
 *   npm run billing:paddle:bootstrap -- --webhook-destination=https://example.com/api/billing/webhook
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PaddleMode = 'sandbox' | 'production';
type CurrencyCode = 'GBP' | 'USD';
type PriceInterval = 'month' | 'year' | 'day' | 'week';

interface PaddleErrorResponse {
  error?: {
    code?: string;
    detail?: string;
    message?: string;
  };
}

interface PaddleListMeta {
  pagination?: {
    per_page?: number;
    estimated_total?: number;
    next?: string | null;
    has_more?: boolean;
  };
}

interface PaddleListResponse<T> extends PaddleErrorResponse {
  data?: T[];
  meta?: PaddleListMeta;
}

interface PaddleDataResponse<T> extends PaddleErrorResponse {
  data?: T;
}

interface PaddleProduct {
  id: string;
  name?: string;
  status?: string;
  tax_category?: string;
  custom_data?: Record<string, unknown>;
}

interface PaddleUnitPrice {
  amount?: string;
  currency_code?: string;
}

interface PaddleBillingCycle {
  interval?: PriceInterval;
  frequency?: number;
}

interface PaddlePrice {
  id: string;
  product_id?: string;
  status?: string;
  name?: string;
  billing_cycle?: PaddleBillingCycle | null;
  unit_price?: PaddleUnitPrice;
  custom_data?: Record<string, unknown>;
}

interface PaddleNotificationSetting {
  id: string;
  destination?: string;
  active?: boolean;
  endpoint_secret_key?: string | null;
  subscribed_events?: Array<{ name?: string } | string>;
}

interface ScriptOptions {
  dryRun: boolean;
  forceCreate: boolean;
  writeEnvPath: string | null;
  webhookDestinationOverride: string | null;
  showHelp: boolean;
}

interface PriceDefinition {
  key: string;
  envVar: string;
  amountMinor: number;
  currency: CurrencyCode;
  recurring: boolean;
  displayName: string;
  description: string;
}

interface ProductDefinition {
  key: string;
  name: string;
  description: string;
  prices: PriceDefinition[];
}

interface PriceResolution {
  definition: PriceDefinition;
  id: string;
  created: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PRODUCT_DEFINITIONS: ProductDefinition[] = [
  {
    key: 'sophia_pro_subscription',
    name: 'SOPHIA Pro',
    description: 'SOPHIA Pro subscription plan for individual users.',
    prices: [
      {
        key: 'sophia_pro_monthly_gbp',
        envVar: 'PADDLE_PRICE_PRO_GBP',
        amountMinor: readMinorUnits('PADDLE_SETUP_PRO_MONTHLY_GBP', 699),
        currency: 'GBP',
        recurring: true,
        displayName: 'Pro Monthly (GBP)',
        description: 'SOPHIA Pro monthly subscription billed in GBP.'
      },
      {
        key: 'sophia_pro_monthly_usd',
        envVar: 'PADDLE_PRICE_PRO_USD',
        amountMinor: readMinorUnits('PADDLE_SETUP_PRO_MONTHLY_USD', 899),
        currency: 'USD',
        recurring: true,
        displayName: 'Pro Monthly (USD)',
        description: 'SOPHIA Pro monthly subscription billed in USD.'
      }
    ]
  },
  {
    key: 'sophia_premium_subscription',
    name: 'SOPHIA Premium',
    description: 'SOPHIA Premium subscription plan for individual users.',
    prices: [
      {
        key: 'sophia_premium_monthly_gbp',
        envVar: 'PADDLE_PRICE_PREMIUM_GBP',
        amountMinor: readMinorUnits('PADDLE_SETUP_PREMIUM_MONTHLY_GBP', 1199),
        currency: 'GBP',
        recurring: true,
        displayName: 'Premium Monthly (GBP)',
        description: 'SOPHIA Premium monthly subscription billed in GBP.'
      },
      {
        key: 'sophia_premium_monthly_usd',
        envVar: 'PADDLE_PRICE_PREMIUM_USD',
        amountMinor: readMinorUnits('PADDLE_SETUP_PREMIUM_MONTHLY_USD', 1499),
        currency: 'USD',
        recurring: true,
        displayName: 'Premium Monthly (USD)',
        description: 'SOPHIA Premium monthly subscription billed in USD.'
      }
    ]
  },
  {
    key: 'sophia_topup_small',
    name: 'SOPHIA Wallet Top-up (Small)',
    description: 'Prepaid BYOK handling-fee wallet top-up (small pack).',
    prices: [
      {
        key: 'sophia_topup_small_gbp',
        envVar: 'PADDLE_PRICE_TOPUP_SMALL_GBP',
        amountMinor: readMinorUnits(
          'PADDLE_SETUP_TOPUP_SMALL_GBP',
          readMinorUnits('BYOK_TOPUP_SMALL_CENTS', 500)
        ),
        currency: 'GBP',
        recurring: false,
        displayName: 'Wallet Top-up Small (GBP)',
        description: 'SOPHIA wallet top-up (small pack) billed in GBP.'
      },
      {
        key: 'sophia_topup_small_usd',
        envVar: 'PADDLE_PRICE_TOPUP_SMALL_USD',
        amountMinor: readMinorUnits(
          'PADDLE_SETUP_TOPUP_SMALL_USD',
          readMinorUnits('BYOK_TOPUP_SMALL_CENTS', 500)
        ),
        currency: 'USD',
        recurring: false,
        displayName: 'Wallet Top-up Small (USD)',
        description: 'SOPHIA wallet top-up (small pack) billed in USD.'
      }
    ]
  },
  {
    key: 'sophia_topup_large',
    name: 'SOPHIA Wallet Top-up (Large)',
    description: 'Prepaid BYOK handling-fee wallet top-up (large pack).',
    prices: [
      {
        key: 'sophia_topup_large_gbp',
        envVar: 'PADDLE_PRICE_TOPUP_LARGE_GBP',
        amountMinor: readMinorUnits(
          'PADDLE_SETUP_TOPUP_LARGE_GBP',
          readMinorUnits('BYOK_TOPUP_LARGE_CENTS', 1500)
        ),
        currency: 'GBP',
        recurring: false,
        displayName: 'Wallet Top-up Large (GBP)',
        description: 'SOPHIA wallet top-up (large pack) billed in GBP.'
      },
      {
        key: 'sophia_topup_large_usd',
        envVar: 'PADDLE_PRICE_TOPUP_LARGE_USD',
        amountMinor: readMinorUnits(
          'PADDLE_SETUP_TOPUP_LARGE_USD',
          readMinorUnits('BYOK_TOPUP_LARGE_CENTS', 1500)
        ),
        currency: 'USD',
        recurring: false,
        displayName: 'Wallet Top-up Large (USD)',
        description: 'SOPHIA wallet top-up (large pack) billed in USD.'
      }
    ]
  }
];

const DEFAULT_WEBHOOK_EVENTS = [
  'transaction.completed',
  'transaction.paid',
  'subscription.created',
  'subscription.updated',
  'subscription.activated',
  'subscription.trialing',
  'subscription.past_due',
  'subscription.canceled'
];

function readMinorUnits(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer in minor units.`);
  }
  return parsed;
}

function parseOptions(args: string[]): ScriptOptions {
  let dryRun = false;
  let forceCreate = false;
  let writeEnvPath: string | null = null;
  let webhookDestinationOverride: string | null = null;
  let showHelp = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
      continue;
    }
    if (arg === '--force-create') {
      forceCreate = true;
      continue;
    }
    if (arg.startsWith('--write-env=')) {
      writeEnvPath = arg.slice('--write-env='.length).trim() || null;
      continue;
    }
    if (arg.startsWith('--webhook-destination=')) {
      webhookDestinationOverride = arg.slice('--webhook-destination='.length).trim() || null;
      continue;
    }
  }

  return {
    dryRun,
    forceCreate,
    writeEnvPath,
    webhookDestinationOverride,
    showHelp
  };
}

function printHelp(): void {
  console.log(`
SOPHIA Paddle bootstrap

Usage:
  npm run billing:paddle:bootstrap
  npm run billing:paddle:bootstrap -- --dry-run
  npm run billing:paddle:bootstrap -- --force-create
  npm run billing:paddle:bootstrap -- --write-env=.env.paddle.generated
  npm run billing:paddle:bootstrap -- --webhook-destination=https://example.com/api/billing/webhook

Required env:
  PADDLE_API_KEY

Optional env:
  PADDLE_ENV=sandbox|production (default: sandbox)
  PUBLIC_APP_URL or PUBLIC_BASE_URL (used for webhook URL + checkout return URLs)
  PADDLE_SETUP_* values for prices in minor units
  PADDLE_SKIP_DISCOVERY=true (equivalent to --force-create)
`);
}

function paddleMode(): PaddleMode {
  return process.env.PADDLE_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
}

function paddleBaseUrl(mode: PaddleMode): string {
  return mode === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function appBaseUrl(): string | null {
  return optionalEnv('PUBLIC_APP_URL') ?? optionalEnv('PUBLIC_BASE_URL');
}

function inferWebhookDestination(override: string | null): string {
  if (override) return override;
  const baseUrl = appBaseUrl();
  if (!baseUrl) {
    throw new Error(
      'Set PUBLIC_APP_URL (or PUBLIC_BASE_URL), or pass --webhook-destination explicitly.'
    );
  }
  return `${baseUrl.replace(/\/+$/, '')}/api/billing/webhook`;
}

function parseWebhookEvents(): string[] {
  const configured = optionalEnv('PADDLE_WEBHOOK_EVENTS');
  if (!configured) return DEFAULT_WEBHOOK_EVENTS;
  const values = configured
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length > 0 ? values : DEFAULT_WEBHOOK_EVENTS;
}

function toMinorAmountString(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid minor unit amount: ${value}`);
  }
  return String(Math.floor(value));
}

function customDataValue(record: Record<string, unknown> | undefined, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function mapSubscribedEvents(
  events: PaddleNotificationSetting['subscribed_events']
): string[] {
  if (!Array.isArray(events)) return [];
  return events
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()));
}

function eventsEqual(actual: string[], expected: string[]): boolean {
  const actualSet = new Set(actual.map((v) => v.trim()));
  const expectedSet = new Set(expected.map((v) => v.trim()));
  if (actualSet.size !== expectedSet.size) return false;
  for (const value of expectedSet) {
    if (!actualSet.has(value)) return false;
  }
  return true;
}

class PaddleClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly dryRun: boolean;
  private readonly maxRetries: number;

  constructor(input: {
    baseUrl: string;
    apiKey: string;
    apiVersion: string;
    dryRun: boolean;
    maxRetries: number;
  }) {
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.apiKey = input.apiKey;
    this.apiVersion = input.apiVersion;
    this.dryRun = input.dryRun;
    this.maxRetries = Math.max(0, input.maxRetries);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Paddle-Version': this.apiVersion
    };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    pathOrUrl: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    let attempt = 0;

    while (true) {
      attempt += 1;
      const response = await fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined
      });

      const raw = await response.text();
      const payload = raw
        ? (JSON.parse(raw) as T & PaddleErrorResponse)
        : ({} as T & PaddleErrorResponse);

      if (response.status === 429 && attempt <= this.maxRetries + 1) {
        const retryAfterRaw = response.headers.get('Retry-After');
        const retryAfterSeconds = Number.parseInt(retryAfterRaw ?? '', 10);
        const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : 2000;
        if (attempt > this.maxRetries) {
          break;
        }
        console.warn(
          `[PADDLE] Rate limit on ${method} ${pathOrUrl}; retrying in ${Math.ceil(waitMs / 1000)}s (attempt ${attempt}/${this.maxRetries + 1})`
        );
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const detail =
          payload?.error?.detail ??
          payload?.error?.message ??
          `HTTP ${response.status}`;
        throw new Error(`[Paddle ${method} ${pathOrUrl}] ${detail}`);
      }
      return payload as T;
    }

    throw new Error(`[Paddle ${method} ${pathOrUrl}] rate-limited after retries`);
  }

  async listAll<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = `${this.baseUrl}${path}`;
    while (nextUrl) {
      const page = await this.request<PaddleListResponse<T>>('GET', nextUrl);
      results.push(...(page.data ?? []));
      const next = page.meta?.pagination?.next ?? null;
      if (!next) break;
      nextUrl = next.startsWith('http') ? next : `${this.baseUrl}${next}`;
    }
    return results;
  }

  async create<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
    if (this.dryRun) return null;
    const response = await this.request<PaddleDataResponse<T>>('POST', path, body);
    return response.data ?? null;
  }

  async patch<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
    if (this.dryRun) return null;
    const response = await this.request<PaddleDataResponse<T>>('PATCH', path, body);
    return response.data ?? null;
  }

  async getOne<T>(path: string): Promise<T | null> {
    const response = await this.request<PaddleDataResponse<T>>('GET', path);
    return response.data ?? null;
  }
}

async function ensureProduct(
  client: PaddleClient,
  existingProducts: PaddleProduct[],
  definition: ProductDefinition,
  taxCategory: string
): Promise<{ product: PaddleProduct; created: boolean }> {
  const match = existingProducts.find((product) => {
    const productKey = customDataValue(product.custom_data, 'sophia_product_key');
    return productKey === definition.key || product.name === definition.name;
  });

  if (match) return { product: match, created: false };

  const payload = {
    name: definition.name,
    description: definition.description,
    tax_category: taxCategory,
    custom_data: {
      integration: 'sophia',
      sophia_product_key: definition.key
    }
  };

  const created = await client.create<PaddleProduct>('/products', payload);
  if (!created) {
    return {
      product: {
        id: `dryrun:${definition.key}`,
        name: definition.name,
        custom_data: payload.custom_data
      },
      created: true
    };
  }
  return { product: created, created: true };
}

async function ensurePrice(
  client: PaddleClient,
  existingPrices: PaddlePrice[],
  productId: string,
  definition: PriceDefinition
): Promise<PriceResolution> {
  const match = existingPrices.find((price) => {
    const priceKey = customDataValue(price.custom_data, 'sophia_price_key');
    return priceKey === definition.key;
  });

  if (match) {
    const existingCurrency = priceCurrency(match);
    const existingAmount = priceAmountMinor(match);
    if (
      existingCurrency &&
      existingCurrency !== definition.currency &&
      !match.id.startsWith('dryrun:')
    ) {
      console.warn(
        `[WARN] ${definition.key} currency mismatch: existing=${existingCurrency} desired=${definition.currency}`
      );
    }
    if (
      existingAmount !== null &&
      existingAmount !== definition.amountMinor &&
      !match.id.startsWith('dryrun:')
    ) {
      console.warn(
        `[WARN] ${definition.key} amount mismatch: existing=${existingAmount} desired=${definition.amountMinor}`
      );
    }
    return {
      definition,
      id: match.id,
      created: false
    };
  }

  const payload: Record<string, unknown> = {
    product_id: productId,
    name: definition.displayName,
    description: definition.description,
    unit_price: {
      amount: toMinorAmountString(definition.amountMinor),
      currency_code: definition.currency
    },
    custom_data: {
      integration: 'sophia',
      sophia_price_key: definition.key
    }
  };

  if (definition.recurring) {
    payload.billing_cycle = {
      interval: 'month',
      frequency: 1
    };
  }

  const created = await client.create<PaddlePrice>('/prices', payload);
  return {
    definition,
    id: created?.id ?? `dryrun:${definition.key}`,
    created: true
  };
}

function priceCurrency(price: PaddlePrice): CurrencyCode | null {
  const value = price.unit_price?.currency_code;
  if (value === 'GBP' || value === 'USD') return value;
  return null;
}

function priceAmountMinor(price: PaddlePrice): number | null {
  const raw = price.unit_price?.amount;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

async function ensureWebhook(
  client: PaddleClient,
  settings: PaddleNotificationSetting[],
  destination: string,
  events: string[],
  apiVersion: number
): Promise<{ id: string; endpointSecret: string | null; created: boolean; updated: boolean }> {
  const existing = settings.find((item) => item.destination?.trim() === destination.trim());
  const description = 'SOPHIA billing webhooks';

  if (!existing) {
    const created = await client.create<PaddleNotificationSetting>('/notification-settings', {
      description,
      destination,
      type: 'url',
      active: true,
      api_version: apiVersion,
      traffic_source: 'platform',
      subscribed_events: events
    });
    return {
      id: created?.id ?? 'dryrun:webhook',
      endpointSecret: created?.endpoint_secret_key ?? null,
      created: true,
      updated: false
    };
  }

  const currentEvents = mapSubscribedEvents(existing.subscribed_events);
  const requiresUpdate = !existing.active || !eventsEqual(currentEvents, events);
  let endpointSecret = existing.endpoint_secret_key ?? null;

  if (requiresUpdate) {
    const patched = await client.patch<PaddleNotificationSetting>(
      `/notification-settings/${existing.id}`,
      {
        description,
        destination,
        active: true,
        api_version: apiVersion,
        traffic_source: 'platform',
        subscribed_events: events
      }
    );
    endpointSecret = patched?.endpoint_secret_key ?? endpointSecret;
  }

  if (!endpointSecret && !existing.id.startsWith('dryrun:')) {
    const fetched = await client.getOne<PaddleNotificationSetting>(
      `/notification-settings/${existing.id}`
    );
    endpointSecret = fetched?.endpoint_secret_key ?? null;
  }

  return {
    id: existing.id,
    endpointSecret,
    created: false,
    updated: requiresUpdate
  };
}

function buildEnvOutput(params: {
  mode: PaddleMode;
  webhookSecret: string | null;
  prices: PriceResolution[];
}): string {
  const lines: string[] = [
    '# Generated by scripts/bootstrap-paddle.ts',
    `# ${new Date().toISOString()}`,
    `PADDLE_ENV=${params.mode}`,
    `PADDLE_WEBHOOK_SECRET=${params.webhookSecret ?? 'REPLACE_WITH_WEBHOOK_SECRET'}`,
    '',
    '# Paddle price IDs used by SOPHIA billing routes'
  ];

  for (const price of params.prices) {
    lines.push(`${price.definition.envVar}=${price.id}`);
  }

  lines.push('');
  lines.push('# Feature flags');
  lines.push('ENABLE_BILLING=true');
  lines.push('ENABLE_BYOK_WALLET_CHARGING=true');
  lines.push('BYOK_WALLET_SHADOW_MODE=true');
  lines.push('');
  lines.push('# Wallet credit amounts (minor units)');
  lines.push(`BYOK_TOPUP_SMALL_CENTS=${readMinorUnits('BYOK_TOPUP_SMALL_CENTS', 500)}`);
  lines.push(`BYOK_TOPUP_LARGE_CENTS=${readMinorUnits('BYOK_TOPUP_LARGE_CENTS', 1500)}`);

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.showHelp) {
    printHelp();
    return;
  }

  const apiKey = requiredEnv('PADDLE_API_KEY');
  const mode = paddleMode();
  const apiVersion = Number.parseInt(process.env.PADDLE_API_VERSION ?? '1', 10) || 1;
  const apiRetryMax = Number.parseInt(process.env.PADDLE_API_RETRY_MAX ?? '10', 10) || 10;
  const apiListPauseMs = Number.parseInt(process.env.PADDLE_API_LIST_PAUSE_MS ?? '750', 10) || 750;
  const skipDiscoveryFromEnv = (process.env.PADDLE_SKIP_DISCOVERY ?? 'false')
    .trim()
    .toLowerCase() === 'true';
  const forceCreate = options.forceCreate || skipDiscoveryFromEnv;
  const taxCategory = optionalEnv('PADDLE_DEFAULT_TAX_CATEGORY') ?? 'standard';
  const webhookDestination = inferWebhookDestination(options.webhookDestinationOverride);
  const webhookEvents = parseWebhookEvents();

  const client = new PaddleClient({
    apiKey,
    baseUrl: paddleBaseUrl(mode),
    apiVersion: String(apiVersion),
    dryRun: options.dryRun,
    maxRetries: apiRetryMax
  });

  console.log(
    `[PADDLE] Mode=${mode} dryRun=${options.dryRun ? 'true' : 'false'} forceCreate=${
      forceCreate ? 'true' : 'false'
    }`
  );
  console.log(`[PADDLE] Base URL=${paddleBaseUrl(mode)}`);
  console.log(`[PADDLE] Webhook destination=${webhookDestination}`);

  let existingProducts: PaddleProduct[] = [];
  let existingPrices: PaddlePrice[] = [];
  let existingNotificationSettings: PaddleNotificationSetting[] = [];
  if (!forceCreate) {
    existingProducts = await client.listAll<PaddleProduct>('/products?per_page=100');
    await sleep(apiListPauseMs);
    existingPrices = await client.listAll<PaddlePrice>('/prices?per_page=100');
    await sleep(apiListPauseMs);
    existingNotificationSettings = await client.listAll<PaddleNotificationSetting>(
      '/notification-settings?per_page=100'
    );
  } else {
    console.log('[PADDLE] Discovery skipped; creating resources directly.');
  }

  const productResults: Array<{ key: string; id: string; created: boolean }> = [];
  const priceResults: PriceResolution[] = [];

  for (const definition of PRODUCT_DEFINITIONS) {
    const productResult = await ensureProduct(client, existingProducts, definition, taxCategory);
    productResults.push({
      key: definition.key,
      id: productResult.product.id,
      created: productResult.created
    });
    if (productResult.created) {
      existingProducts.push(productResult.product);
    }

    for (const priceDefinition of definition.prices) {
      const priceResult = await ensurePrice(
        client,
        existingPrices,
        productResult.product.id,
        priceDefinition
      );
      priceResults.push(priceResult);
      if (priceResult.created) {
        existingPrices.push({
          id: priceResult.id,
          product_id: productResult.product.id,
          custom_data: {
            integration: 'sophia',
            sophia_price_key: priceDefinition.key
          },
          unit_price: {
            amount: String(priceDefinition.amountMinor),
            currency_code: priceDefinition.currency
          }
        });
      }
    }
  }

  const webhookResult = await ensureWebhook(
    client,
    existingNotificationSettings,
    webhookDestination,
    webhookEvents,
    apiVersion
  );

  const envOutput = buildEnvOutput({
    mode,
    webhookSecret: webhookResult.endpointSecret,
    prices: priceResults
  });

  console.log('');
  console.log('=== SOPHIA Paddle Bootstrap Summary ===');
  for (const product of productResults) {
    console.log(
      `Product ${product.key}: ${product.id} ${product.created ? '(created)' : '(reused)'}`
    );
  }
  for (const price of priceResults) {
    console.log(
      `Price ${price.definition.key}: ${price.id} ${price.created ? '(created)' : '(reused)'}`
    );
  }
  console.log(
    `Webhook setting: ${webhookResult.id} ${
      webhookResult.created ? '(created)' : webhookResult.updated ? '(updated)' : '(reused)'
    }`
  );
  if (!webhookResult.endpointSecret) {
    console.warn(
      '[WARN] Could not resolve endpoint secret from API response. Check Paddle dashboard and set PADDLE_WEBHOOK_SECRET manually.'
    );
  }

  console.log('');
  console.log('=== Suggested .env block ===');
  console.log(envOutput);

  if (options.writeEnvPath) {
    const absolutePath = resolve(process.cwd(), options.writeEnvPath);
    writeFileSync(absolutePath, envOutput, 'utf-8');
    console.log(`[PADDLE] Wrote generated env block to ${absolutePath}`);
  }
}

main().catch((err) => {
  console.error('[PADDLE] Bootstrap failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
