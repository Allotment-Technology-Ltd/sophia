import * as https from 'node:https';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import {
  DEFAULT_MODEL_CATALOG,
  REASONING_PROVIDER_BASE_URL_ENV,
  REASONING_PROVIDER_DEFAULT_BASE_URL,
  REASONING_PROVIDER_ORDER,
  REASONING_PROVIDER_PLATFORM_API_KEY_ENV,
  getModelProviderLabel,
  isReasoningProvider,
  type ModelProvider,
  type ReasoningProvider
} from '@restormel/contracts/providers';
import { loadServerEnv } from './env';
import type { ProviderApiKeys } from './byok/types';
import { normalizeAizoloModelIdForApi } from './aizoloModelIds.js';
import {
  restormelPostCatalogObservation,
  type RestormelFallbackCandidate,
  type RestormelStepChainEntry
} from './restormel';
import { resolveProviderDecision, type ResolveFailureKind } from './resolve-provider';
import {
  getDegradedModelOverride,
  getDegradedPrimaryProviderOverride,
  getNeonDefaultOpenAiApiKeySync
} from './appAiDefaults.js';
import {
  ingestFinetuneLabelerStrictEnabled,
  isFinetuneSensitiveLlmStage,
  parseFinetuneLabelerAllowedProviders
} from '../ingestionFinetuneLabelerPolicy.js';

let anthropicInstance: ReturnType<typeof createAnthropic> | null = null;
const anthropicByApiKey = new Map<string, ReturnType<typeof createAnthropic>>();
const openAICompatibleByCacheKey = new Map<string, ReturnType<typeof createOpenAI>>();
/** Ingestion-only OpenAI-compatible extraction (`EXTRACTION_BASE_URL`); isolated from catalog `openai` keys. */
const extractionOpenAiOverrideByCacheKey = new Map<string, ReturnType<typeof createOpenAI>>();
const mistralByApiKey = new Map<string, ReturnType<typeof createMistral>>();

function getAnthropicForApiKey(apiKey?: string) {
  if (apiKey) {
    const existing = anthropicByApiKey.get(apiKey);
    if (existing) return existing;
    const instance = createAnthropic({ apiKey });
    anthropicByApiKey.set(apiKey, instance);
    return instance;
  }

  if (anthropicInstance) return anthropicInstance;
  loadServerEnv();
  anthropicInstance = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });
  return anthropicInstance;
}

function getPlatformApiKey(provider: ReasoningProvider): string | undefined {
  const envName = REASONING_PROVIDER_PLATFORM_API_KEY_ENV[provider];
  if (!envName) return undefined;
  const fromEnv = process.env[envName]?.trim() || undefined;
  if (provider === 'openai') {
    const fromNeon = getNeonDefaultOpenAiApiKeySync()?.trim();
    if (fromNeon) return fromNeon;
  }
  return fromEnv || undefined;
}

function getProviderBaseUrl(provider: Exclude<ReasoningProvider, 'vertex' | 'anthropic'>): string | undefined {
  const envName = REASONING_PROVIDER_BASE_URL_ENV[provider];
  const fromEnv = envName ? process.env[envName]?.trim() : undefined;
  return fromEnv || REASONING_PROVIDER_DEFAULT_BASE_URL[provider];
}

function getMistralForApiKey(apiKey?: string) {
  const resolvedApiKey = apiKey?.trim() || getPlatformApiKey('mistral');
  if (!resolvedApiKey) {
    throw new Error('mistral provider requested but no API key is configured');
  }
  const baseURL = getProviderBaseUrl('mistral');
  const cacheKey = `${resolvedApiKey}:${baseURL ?? ''}`;
  const existing = mistralByApiKey.get(cacheKey);
  if (existing) return existing;

  const instance = createMistral({
    apiKey: resolvedApiKey,
    ...(baseURL ? { baseURL } : {})
  });
  mistralByApiKey.set(cacheKey, instance);
  return instance;
}

/**
 * Together’s chat API accepts `max_completion_tokens`, but some OpenAI-compatible stacks
 * behave better with `max_tokens` only. The AI SDK may send `max_completion_tokens` for
 * non-OpenAI model ids; normalize the JSON body for Together hosts.
 */
function togetherOpenAiCompatibleFetch(
	baseURL: string,
	inner: typeof fetch = globalThis.fetch.bind(globalThis)
): typeof fetch {
	if (!baseURL.includes('together.xyz')) return inner;
	return async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
		if (!url.includes('together.xyz') || !url.includes('/chat/completions')) {
			return inner(input as RequestInfo | URL, init as RequestInit | undefined);
		}
		if (!init?.body || typeof init.body !== 'string') {
			return inner(input as RequestInfo | URL, init as RequestInit | undefined);
		}
		try {
			const j = JSON.parse(init.body) as Record<string, unknown>;
			const mc = j.max_completion_tokens;
			if (mc != null) {
				if (j.max_tokens == null) j.max_tokens = mc;
				delete j.max_completion_tokens;
			}
			return inner(input as RequestInfo | URL, {
				...init,
				body: JSON.stringify(j)
			});
		} catch {
			return inner(input as RequestInfo | URL, init as RequestInit | undefined);
		}
	};
}

function isGoogleAiOpenAiCompatibleHost(baseOrUrl: string): boolean {
	try {
		const parsed = new URL(baseOrUrl);
		const host = parsed.hostname.toLowerCase();
		const path = parsed.pathname;
		return (
			host === 'generativelanguage.googleapis.com' &&
			(path === '/' || path.startsWith('/v1beta/openai'))
		);
	} catch {
		return false;
	}
}

/** Google AI Studio OpenAI-compatible Chat Completions base (API key + Bearer; not Vertex regional ADC). */
export const GOOGLE_AI_STUDIO_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * Operators sometimes put `?key=` on **`EXTRACTION_BASE_URL`** (copy-paste from REST docs). Any env
 * layer (root `.env`, `.env.local`, CI, or a pasted shell export) can supply that shape. Together with
 * **`Authorization: Bearer`** from `createOpenAI({ apiKey })`, Google returns **400** *Multiple
 * authentication credentials* — so we strip `key` from the base URL and from outbound request URLs.
 */
function sanitizeGoogleOpenAiCompatibleBaseUrl(baseURL: string): string {
	if (!isGoogleAiOpenAiCompatibleHost(baseURL)) return baseURL;
	try {
		const u = new URL(baseURL);
		u.searchParams.delete('key');
		return u.toString().replace(/\?$/, '');
	} catch {
		return baseURL;
	}
}

function resolveFetchHref(input: RequestInfo | URL): string {
	if (typeof input === 'string') return input;
	if (input instanceof URL) return input.href;
	if (input instanceof Request) return input.url;
	return String(input);
}

/** Same query stripping as {@link sanitizeGoogleOpenAiCompatibleBaseUrl}, for outbound request URLs. */
function stripGoogleOpenAiCompatKeyQueryFromHref(href: string): string {
	if (!isGoogleAiOpenAiCompatibleHost(href)) return href;
	try {
		const u = new URL(href);
		if (!u.searchParams.has('key')) return href;
		u.searchParams.delete('key');
		return u.toString().replace(/\?$/, '');
	} catch {
		return href;
	}
}

function withGenerativeLanguageUrlWithoutKeyQuery(
	input: RequestInfo | URL,
	cleanedHref: string
): RequestInfo | URL {
	if (typeof input === 'string') return cleanedHref;
	if (input instanceof URL) return new URL(cleanedHref);
	if (input instanceof Request) return new Request(cleanedHref, input);
	return cleanedHref;
}

/** Headers Google’s OpenAI-compat gateway tolerates without counting a second “credential”. */
const GOOGLE_OPENAI_COMPAT_OUTBOUND_HEADER_ALLOWLIST = new Set([
	'accept',
	'authorization',
	'content-type',
	'user-agent'
]);

function allowlistHeadersForGoogleGenerativeLanguageOpenAi(raw: Headers): Headers {
	const out = new Headers();
	raw.forEach((value, key) => {
		if (GOOGLE_OPENAI_COMPAT_OUTBOUND_HEADER_ALLOWLIST.has(key.toLowerCase())) {
			out.set(key, value);
		}
	});
	return out;
}

/**
 * `postToApi` always passes a string body for JSON chat calls; avoid streaming / FormData here.
 */
function stringifyGoogleOpenAiCompatRequestBody(body: BodyInit | null | undefined): string | undefined {
	if (body === null || body === undefined) return undefined;
	if (typeof body === 'string') return body;
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) return body.toString('utf8');
	if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
	return undefined;
}

/**
 * Use **`node:https`** instead of `globalThis.fetch` so a patched global fetch (proxies, agents, or
 * tooling) cannot inject a second Google credential (`x-goog-api-key`, `?key=`, etc.) after we allowlist.
 */
async function googleGenerativeLanguageOpenAiHttpsFetch(
	input: RequestInfo | URL,
	init?: RequestInit
): Promise<Response> {
	const href = resolveFetchHref(input as RequestInfo | URL);
	const u = new URL(href);
	if (u.protocol !== 'https:') {
		throw new Error(`generativelanguage OpenAI-compat fetch expects https URL, got ${u.protocol}`);
	}
	const method = init?.method ?? 'POST';
	const body = stringifyGoogleOpenAiCompatRequestBody(init?.body ?? undefined);
	const headerRecord: Record<string, string> = {};
	new Headers(init?.headers ?? undefined).forEach((value, key) => {
		headerRecord[key] = value;
	});

	return await new Promise<Response>((resolve, reject) => {
		const req = https.request(
			{
				hostname: u.hostname,
				port: u.port || 443,
				path: u.pathname + u.search,
				method,
				headers: headerRecord,
				...(init?.signal ? { signal: init.signal } : {})
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => {
					const buf = Buffer.concat(chunks);
					const outHeaders = new Headers();
					for (const [k, v] of Object.entries(res.headers)) {
						if (v === undefined) continue;
						if (Array.isArray(v)) {
							for (const item of v) outHeaders.append(k, item);
						} else {
							outHeaders.set(k, v);
						}
					}
					resolve(
						new Response(buf.length > 0 ? new Uint8Array(buf) : null, {
							status: res.statusCode ?? 0,
							statusText: res.statusMessage ?? '',
							headers: outHeaders
						})
					);
				});
			}
		);
		req.on('error', reject);
		if (body !== undefined) req.write(body);
		req.end();
	});
}

/**
 * Generative Language **OpenAI-compatible** (`…/v1beta/openai`):
 * - Requires **`Authorization: Bearer <api_key>`** (what `createOpenAI({ apiKey })` sends). Stripping it
 *   yields **400** *Missing or invalid Authorization header*.
 * - Rejects **400** *Multiple authentication credentials* if **another** mechanism is also present —
 *   e.g. **`x-goog-api-key`**, **`?key=`** on the URL, **`OpenAI-Organization` / `OpenAI-Project`**, or any
 *   other header a proxy or SDK layer adds alongside Bearer. We strip URL `key`, **allowlist** headers,
 *   then send via **`node:https`** so a patched `globalThis.fetch` cannot re-inject credentials.
 */
function generativeLanguageOpenAiCompatibleFetch(_apiKey: string): typeof fetch {
	return async (input, init) => {
		const rawHeaders = new Headers(
			init?.headers !== undefined ? (init.headers as HeadersInit) : undefined
		);
		const headers = allowlistHeadersForGoogleGenerativeLanguageOpenAi(rawHeaders);

		const href = resolveFetchHref(input as RequestInfo | URL);
		const cleanedHref = stripGoogleOpenAiCompatKeyQueryFromHref(href);
		const nextInput =
			cleanedHref === href ? (input as RequestInfo | URL) : withGenerativeLanguageUrlWithoutKeyQuery(input as RequestInfo | URL, cleanedHref);

		return googleGenerativeLanguageOpenAiHttpsFetch(nextInput as RequestInfo | URL, {
			...init,
			headers,
			method: init?.method ?? 'POST'
		} as RequestInit);
	};
}

function extractionOverrideFetchForBaseUrl(baseURL: string, apiKey: string): typeof fetch {
	if (isGoogleAiOpenAiCompatibleHost(baseURL)) {
		return generativeLanguageOpenAiCompatibleFetch(apiKey);
	}
	return togetherOpenAiCompatibleFetch(baseURL);
}

function getOpenAIForExtractionOverride(baseURL: string, apiKey: string) {
	const cacheKey = `${baseURL}::${apiKey}`;
	const existing = extractionOpenAiOverrideByCacheKey.get(cacheKey);
	if (existing) return existing;
	const instance = createOpenAI({
		baseURL,
		apiKey,
		fetch: extractionOverrideFetchForBaseUrl(baseURL, apiKey)
	});
	extractionOpenAiOverrideByCacheKey.set(cacheKey, instance);
	return instance;
}

/** Gemini on Google AI Studio via OpenAI-compatible chat (same transport as `EXTRACTION_BASE_URL` generativelanguage hosts). */
export function getGoogleAiStudioOpenAiCompatibleChatModel(apiKey: string, modelId: string) {
	const client = getOpenAIForExtractionOverride(GOOGLE_AI_STUDIO_OPENAI_BASE_URL, apiKey.trim());
	return client.chat(modelId as any);
}

/**
 * When **`EXTRACTION_BASE_URL`** and **`EXTRACTION_MODEL`** are set, ingestion `planIngestionStage('extraction')`
 * uses this OpenAI-compatible chat route (Fireworks, vLLM, Together-hosted chat, etc.).
 * API key: **`EXTRACTION_API_KEY`** if set; otherwise **host-specific** keys so operator BYOK
 * (`OPENAI_API_KEY` merged into ingest workers) does not override Fireworks: on **`api.fireworks.ai`**
 * use **`FIREWORKS_API_KEY`** then `OPENAI_API_KEY`; on **Together** use **`TOGETHER_API_KEY`** then
 * `OPENAI_API_KEY`; on **Google AI Studio OpenAI-compatible** hosts (`generativelanguage.googleapis.com` … `/openai`)
 * use **`GOOGLE_AI_API_KEY`** (or **`GEMINI_API_KEY`** / **`GOOGLE_GENAI_API_KEY`** after `loadServerEnv()` merges);
 * elsewhere `OPENAI_API_KEY`, then Together, then Fireworks.
 * Does not affect `resolveExtractionModelRoute` callers outside ingestion planning (e.g. verification extraction).
 */
export function readExtractionOpenAiCompatibleOverride():
  | { baseURL: string; apiKey: string; modelId: string }
  | null {
  loadServerEnv();
  const baseURLRaw = process.env.EXTRACTION_BASE_URL?.trim();
  const modelId = process.env.EXTRACTION_MODEL?.trim();
  if (!baseURLRaw || !modelId) return null;
  const baseURL = sanitizeGoogleOpenAiCompatibleBaseUrl(baseURLRaw);
  const explicit = process.env.EXTRACTION_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const togetherKey = process.env.TOGETHER_API_KEY?.trim();
  const fireworksKey = process.env.FIREWORKS_API_KEY?.trim();

  /** Prefer vendor keys for that host before generic `OPENAI_API_KEY` (BYOK merges OpenAI for catalog routes). */
  const googleAiKey = process.env.GOOGLE_AI_API_KEY?.trim();
  const geminiAlt = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_GENAI_API_KEY?.trim();
  let apiKey: string | undefined;
  if (explicit) {
    apiKey = explicit;
  } else if (baseURL.includes('fireworks.ai')) {
    apiKey = fireworksKey || openaiKey;
  } else if (baseURL.includes('together.xyz')) {
    apiKey = togetherKey || openaiKey;
  } else if (isGoogleAiOpenAiCompatibleHost(baseURL)) {
    /** Google AI Studio OpenAI-compatible chat (`…/v1beta/openai`) uses the same API key as catalog Gemini. */
    apiKey = googleAiKey || geminiAlt || openaiKey || togetherKey || fireworksKey;
  } else {
    apiKey = openaiKey || togetherKey || fireworksKey;
  }

  if (!apiKey) {
    throw new Error(
      'EXTRACTION_BASE_URL and EXTRACTION_MODEL require EXTRACTION_API_KEY, or OPENAI_API_KEY, or (on Fireworks) FIREWORKS_API_KEY, or (on Together) TOGETHER_API_KEY, or (on generativelanguage.googleapis.com OpenAI-compatible URLs) GOOGLE_AI_API_KEY / GEMINI_API_KEY'
    );
  }
  /** First line; strip accidental `Bearer `; first whitespace-/comma-delimited token only (avoids pasted doubles). */
  let t = apiKey.trim();
  while (t.toLowerCase().startsWith('bearer ')) t = t.slice(7).trim();
  const line = (t.split(/\r?\n/)[0] ?? '').trim();
  const apiKeyOneLine = line.split(/[\s,;]+/).find((x) => x.length > 0) ?? '';
  if (!apiKeyOneLine) {
    throw new Error(
      'EXTRACTION_BASE_URL and EXTRACTION_MODEL require a non-empty API key after normalizing EXTRACTION_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY'
    );
  }
  return { baseURL, apiKey: apiKeyOneLine, modelId };
}

function isGenerativeLanguageHost(baseURL: string): boolean {
  try {
    return new URL(baseURL).hostname.toLowerCase() === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}

export function buildExtractionOpenAiCompatibleRoute(): ReasoningModelRoute | null {
  const o = readExtractionOpenAiCompatibleOverride();
  if (!o) return null;

  const client = getOpenAIForExtractionOverride(o.baseURL, o.apiKey);
  const model = client.chat(o.modelId as any);
  const googleAiStudioOpenAi = isGenerativeLanguageHost(o.baseURL);
  return {
    model,
    /** Same Gemini billing/telemetry family as catalog `vertex`; transport is OpenAI-compatible Chat Completions. */
    provider: googleAiStudioOpenAi ? 'vertex' : 'openai',
    modelId: o.modelId,
    supportsGrounding: false,
    credentialSource: 'byok',
    routingSource: 'requested',
    resolvedExplanation: googleAiStudioOpenAi
      ? 'Google AI Studio Gemini via OpenAI-compatible Chat Completions (generativelanguage.googleapis.com …/v1beta/openai); avoids native Google Generative AI SDK.'
      : 'OpenAI-compatible ingestion extraction (EXTRACTION_BASE_URL + EXTRACTION_MODEL); Restormel resolve skipped for this stage plan.',
    resolvedRouteId: null,
    resolvedFailureKind: undefined,
    resolvedStepId: null,
    resolvedOrderIndex: null,
    resolvedSwitchReasonCode: null,
    resolvedEstimatedCostUsd: null,
    resolvedMatchedCriteria: null,
    resolvedFallbackCandidates: null,
    resolvedStepChain: null
  };
}

function getOpenAICompatibleForProvider(
  provider: Exclude<ReasoningProvider, 'vertex' | 'anthropic'>,
  apiKey?: string
) {
  const resolvedApiKey = apiKey?.trim() || getPlatformApiKey(provider);
  if (!resolvedApiKey) {
    throw new Error(`${provider} provider requested but no API key is configured`);
  }

  const baseURL = getProviderBaseUrl(provider);
  const cacheKey = `${provider}:${resolvedApiKey}:${baseURL ?? ''}`;
  const existing = openAICompatibleByCacheKey.get(cacheKey);
  if (existing) return existing;

  const instance = createOpenAI({
    apiKey: resolvedApiKey,
    ...(baseURL ? { baseURL } : {})
  });
  openAICompatibleByCacheKey.set(cacheKey, instance);
  return instance;
}

type RoutingPass = 'analysis' | 'critique' | 'synthesis' | 'verification' | 'generic';
type RequestedProvider = ModelProvider;

export interface ReasoningModelRoute {
  model: any;
  provider: ReasoningProvider;
  modelId: string;
  /** Reserved; Google Search grounding via Vertex ADC was removed with Phase 3c (GCP LLM exit). */
  supportsGrounding: boolean;
  credentialSource: 'byok' | 'platform';
  routingSource?: 'restormel' | 'requested' | 'degraded_default';
  resolvedRouteId?: string | null;
  resolvedExplanation?: string | null;
  resolvedFailureKind?: ResolveFailureKind;
  resolvedStepId?: string | null;
  resolvedOrderIndex?: number | null;
  resolvedSwitchReasonCode?: string | null;
  resolvedEstimatedCostUsd?: number | null;
  resolvedMatchedCriteria?: unknown;
  resolvedFallbackCandidates?: RestormelFallbackCandidate[] | null;
  resolvedStepChain?: RestormelStepChainEntry[] | null;
}

export interface AvailableModelOption {
  id: string;
  provider: ReasoningProvider;
  label: string;
  description: string;
  credential_source?: 'byok' | 'platform';
}

/** Degraded-default reasoning when Restormel resolve fails: prefer OpenAI (cost + TPM) when keys exist. */
const DEGRADED_DEFAULT_PROVIDER_ORDER: ReasoningProvider[] = [
  'openai',
  ...REASONING_PROVIDER_ORDER.filter((p) => p !== 'openai')
];

const OPENAI_DEGRADED_STANDARD_MODEL =
  DEFAULT_MODEL_CATALOG.openai.find((id) => id.includes('gpt-4o-mini')) ?? 'gpt-4o-mini';
const OPENAI_DEGRADED_DEEP_MODEL =
  DEFAULT_MODEL_CATALOG.openai.find((id) => id === 'gpt-4o') ??
  DEFAULT_MODEL_CATALOG.openai.find((id) => id.startsWith('gpt-4o')) ??
  'gpt-4o';

const VERTEX_DEGRADED_STANDARD_MODEL =
  DEFAULT_MODEL_CATALOG.vertex.find((id) => id.includes('gemini-3') && id.includes('flash')) ??
  DEFAULT_MODEL_CATALOG.vertex.find((id) => id.includes('flash') && id.includes('2.5')) ??
  DEFAULT_MODEL_CATALOG.vertex[1] ??
  'gemini-3-flash-preview';
const VERTEX_DEGRADED_DEEP_MODEL =
  DEFAULT_MODEL_CATALOG.vertex.find((id) => id.includes('gemini-3') && id.includes('pro')) ??
  DEFAULT_MODEL_CATALOG.vertex.find((id) => id.includes('2.5-pro')) ??
  DEFAULT_MODEL_CATALOG.vertex[0] ??
  'gemini-3.1-pro-preview';

type RouteRestormelContext = {
  workload?: string;
  stage?: string;
  task?: string;
  attempt?: number;
  estimatedInputTokens?: number;
  estimatedInputChars?: number;
  complexity?: string;
  constraints?: {
    latency?: string;
    maxCost?: number;
  };
  previousFailure?: {
    failureKind?: string;
    providerType?: string;
    modelId?: string;
    [key: string]: unknown;
  };
};

function normalizeAllowedReasoningProvider(provider: string): ReasoningProvider | null {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'google' || normalized === 'vertex_ai') return 'vertex';
  return isReasoningProvider(normalized) ? normalized : null;
}

function finetuneAllowedDegradedProvidersForIngestion(
  restormelContext?: RouteRestormelContext
): ReasoningProvider[] | undefined {
  if (!ingestFinetuneLabelerStrictEnabled(process.env)) return undefined;
  if (restormelContext?.workload?.trim().toLowerCase() !== 'ingestion') return undefined;

  const rawStage = restormelContext.stage?.trim().toLowerCase() ?? '';
  const stage = rawStage.startsWith('ingestion_') ? rawStage.slice('ingestion_'.length) : rawStage;
  if (!isFinetuneSensitiveLlmStage(stage)) return undefined;

  const allowed = new Set<ReasoningProvider>();
  for (const provider of parseFinetuneLabelerAllowedProviders(process.env)) {
    const normalized = normalizeAllowedReasoningProvider(provider);
    if (normalized) allowed.add(normalized);
  }
  if ((stage === 'extraction' || stage === 'json_repair') && process.env.EXTRACTION_BASE_URL?.trim()) {
    allowed.add('openai');
  }

  return REASONING_PROVIDER_ORDER.filter((provider) => allowed.has(provider));
}

function uniqueModelIds(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const modelId = value?.trim();
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    out.push(modelId);
  }
  return out;
}

function getDefaultReasoningModelId(
  provider: ReasoningProvider,
  depthMode: 'quick' | 'standard' | 'deep' = 'standard',
  pass: RoutingPass = 'generic'
): string {
  const catalog = DEFAULT_MODEL_CATALOG[provider];
  if (!catalog || catalog.length === 0) {
    if (provider === 'vertex') {
      return depthMode === 'deep' || pass === 'verification'
        ? VERTEX_DEGRADED_DEEP_MODEL
        : VERTEX_DEGRADED_STANDARD_MODEL;
    }
    if (provider === 'openai') {
      return depthMode === 'deep' || pass === 'verification'
        ? OPENAI_DEGRADED_DEEP_MODEL
        : OPENAI_DEGRADED_STANDARD_MODEL;
    }
    return OPENAI_DEGRADED_STANDARD_MODEL;
  }

  if (provider === 'vertex') {
    return depthMode === 'deep' || pass === 'verification'
      ? VERTEX_DEGRADED_DEEP_MODEL
      : VERTEX_DEGRADED_STANDARD_MODEL;
  }

  if (provider === 'openai') {
    return depthMode === 'deep' || pass === 'verification'
      ? OPENAI_DEGRADED_DEEP_MODEL
      : OPENAI_DEGRADED_STANDARD_MODEL;
  }

  if (provider === 'anthropic') {
    if (depthMode === 'deep') {
      return catalog[0] ?? catalog[1] ?? OPENAI_DEGRADED_STANDARD_MODEL;
    }
    return catalog[1] ?? catalog[0] ?? OPENAI_DEGRADED_STANDARD_MODEL;
  }

  return catalog[0] ?? OPENAI_DEGRADED_STANDARD_MODEL;
}

function getDefaultExtractionModelId(provider: ReasoningProvider): string {
  if (provider === 'vertex') return VERTEX_DEGRADED_STANDARD_MODEL;
  if (provider === 'openai') return OPENAI_DEGRADED_STANDARD_MODEL;
  return DEFAULT_MODEL_CATALOG[provider][0] ?? OPENAI_DEGRADED_STANDARD_MODEL;
}

/**
 * Anthropic Messages API expects dated snapshot ids (or documented aliases like
 * `claude-sonnet-4-0`). Catalogs and Restormel often emit bare slugs such as
 * `claude-sonnet-4`, which return 404 from the API — map those here.
 *
 * @see https://docs.anthropic.com/en/docs/about-claude/models
 */
export function normalizeAnthropicModelIdForApi(modelId: string): string {
  const map: Record<string, string> = {
    'claude-sonnet-4': 'claude-sonnet-4-20250514',
    'claude-sonnet-4-0': 'claude-sonnet-4-20250514',
    'claude-opus-4': 'claude-opus-4-20250514',
    'claude-opus-4-0': 'claude-opus-4-20250514'
  };
  const m = modelId.trim();
  return map[m] ?? m;
}

function buildVertexRoute(modelId: string, byokVertexKey?: string): ReasoningModelRoute {
  const key = byokVertexKey?.trim() || getPlatformApiKey('vertex')?.trim();
  if (!key) {
    throw new Error(
      'Gemini (catalog provider `vertex`) requires GOOGLE_AI_API_KEY or a stored Gemini/Google BYOK key. Vertex ADC is not supported.'
    );
  }

  const client = getOpenAIForExtractionOverride(GOOGLE_AI_STUDIO_OPENAI_BASE_URL, key);
  return {
    model: client.chat(modelId as any),
    provider: 'vertex',
    modelId,
    supportsGrounding: false,
    credentialSource: byokVertexKey?.trim() ? 'byok' : 'platform'
  };
}

function buildAnthropicRoute(modelId: string, byokAnthropicKey?: string): ReasoningModelRoute {
  const apiModelId = normalizeAnthropicModelIdForApi(modelId);
  if (byokAnthropicKey) {
    return {
      model: getAnthropicForApiKey(byokAnthropicKey)(apiModelId),
      provider: 'anthropic',
      modelId: apiModelId,
      supportsGrounding: false,
      credentialSource: 'byok'
    };
  }

  return {
    model: getAnthropicForApiKey()(apiModelId),
    provider: 'anthropic',
    modelId: apiModelId,
    supportsGrounding: false,
    credentialSource: 'platform'
  };
}

/**
 * Mistral must use `@ai-sdk/mistral`, not `createOpenAI` against api.mistral.ai:
 * `@ai-sdk/openai` treats non-`gpt-*` ids as “reasoning” models and sends
 * `max_completion_tokens`, which Mistral rejects (`extra_forbidden`).
 */
function buildMistralRoute(modelId: string, byokMistralKey?: string): ReasoningModelRoute {
  return {
    model: getMistralForApiKey(byokMistralKey)(modelId),
    provider: 'mistral',
    modelId,
    supportsGrounding: false,
    credentialSource: byokMistralKey ? 'byok' : 'platform'
  };
}

function buildOpenAICompatibleRoute(
  provider: Exclude<ReasoningProvider, 'vertex' | 'anthropic'>,
  modelId: string,
  apiKey?: string
): ReasoningModelRoute {
  const client = getOpenAICompatibleForProvider(provider, apiKey);
  const apiModelId = provider === 'aizolo' ? normalizeAizoloModelIdForApi(modelId) : modelId;
  const model =
    provider === 'openai'
      ? client(apiModelId)
      : client.chat(apiModelId as any);
  return {
    model,
    provider,
    modelId,
    supportsGrounding: false,
    credentialSource: apiKey ? 'byok' : 'platform'
  };
}

function buildRouteForProvider(
  provider: ReasoningProvider,
  modelId: string,
  providerApiKeys?: ProviderApiKeys
): ReasoningModelRoute {
  const byokKey = providerApiKeys?.[provider]?.trim();

  if (provider === 'vertex') {
    return buildVertexRoute(modelId, byokKey);
  }
  if (provider === 'anthropic') {
    return buildAnthropicRoute(modelId, byokKey);
  }
  if (provider === 'mistral') {
    return buildMistralRoute(modelId, byokKey);
  }
  return buildOpenAICompatibleRoute(provider, modelId, byokKey);
}

function hasProviderAccess(
  provider: ReasoningProvider,
  providerApiKeys?: ProviderApiKeys
): boolean {
  if (providerApiKeys?.[provider]?.trim()) return true;
  return Boolean(getPlatformApiKey(provider));
}

function buildSafeDefaultDecision(
  type: 'reasoning' | 'extraction',
  depthMode: 'quick' | 'standard' | 'deep',
  pass: RoutingPass,
  providerApiKeys?: ProviderApiKeys,
  allowedProviders?: readonly ReasoningProvider[]
): { provider: ReasoningProvider; model: string; explanation: string } {
  const primaryOverride = getDegradedPrimaryProviderOverride();
  const allowed = allowedProviders ? new Set(allowedProviders) : null;
  const providerOrder: ReasoningProvider[] = primaryOverride
    ? [primaryOverride, ...DEGRADED_DEFAULT_PROVIDER_ORDER.filter((p) => p !== primaryOverride)]
    : [...DEGRADED_DEFAULT_PROVIDER_ORDER];

  for (const provider of providerOrder) {
    if (allowed && !allowed.has(provider)) continue;
    if (!hasProviderAccess(provider, providerApiKeys)) continue;
    const extOverride = getDegradedModelOverride('extraction');
    const stdOverride = getDegradedModelOverride('reasoning_standard');
    const deepOverride = getDegradedModelOverride('reasoning_deep');
    const model =
      type === 'extraction'
        ? extOverride ?? getDefaultExtractionModelId(provider)
        : depthMode === 'deep' || pass === 'verification'
          ? deepOverride ?? getDefaultReasoningModelId(provider, depthMode, pass)
          : stdOverride ?? getDefaultReasoningModelId(provider, depthMode, pass);
    return {
      provider,
      model,
      explanation: `Restormel resolve was unavailable, so Sophia used the ${provider}/${model} degraded default.`
    };
  }
  if (allowed) {
    throw new Error(
      `No fine-tune-compatible degraded-default provider credentials are configured for ingestion (allowed=${[
        ...allowed
      ].join(',')}). Configure one of those providers, publish a Restormel ingestion route that Sophia can execute locally, or temporarily set INGEST_FINETUNE_LABELER_STRICT=0 for local experiments only.`
    );
  }
  throw new Error(
    'No AI provider credentials are configured. Set at least one of: GOOGLE_AI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, … (see .env.example).'
  );
}

async function resolveRoute(options: {
  type: 'reasoning' | 'extraction';
  depthMode?: 'quick' | 'standard' | 'deep';
  pass?: RoutingPass;
  requestedProvider?: RequestedProvider;
  requestedModelId?: string;
  providerApiKeys?: ProviderApiKeys;
  routeId?: string;
  failureMode?: 'degraded_default' | 'error';
  restormelContext?: RouteRestormelContext;
}): Promise<ReasoningModelRoute> {
  const depthMode = options.depthMode ?? 'standard';
  const pass = options.pass ?? 'generic';
  const allowedDegradedProviders = finetuneAllowedDegradedProvidersForIngestion(
    options.restormelContext
  );
  const safeDefault = buildSafeDefaultDecision(
    options.type,
    depthMode,
    pass,
    options.providerApiKeys,
    allowedDegradedProviders
  );
  const decision = await resolveProviderDecision({
    preferredProvider: options.requestedProvider,
    preferredModel: options.requestedModelId,
    routeId: options.routeId,
    restormelContext: options.restormelContext,
    safeDefault,
    failureMode: options.failureMode ?? 'degraded_default'
  });

  if (!hasProviderAccess(decision.provider, options.providerApiKeys)) {
    const missingProviderMessage =
      `${decision.provider} provider requested but no BYOK key or platform API key is configured`;

    if (options.failureMode !== 'error' && decision.source === 'restormel') {
      const keyEnv = REASONING_PROVIDER_PLATFORM_API_KEY_ENV[decision.provider];
      const keyHint = keyEnv
        ? `Configure ${keyEnv} on the worker (or add ${decision.provider} in Admin → Operator BYOK) so Restormel’s selected route can run. `
        : '';
      console.warn(
        '[restormel] Selected provider is unavailable locally; using degraded default route',
        {
          routeId: decision.routeId,
          provider: decision.provider,
          model: decision.model,
          selectedStepId: decision.selectedStepId,
          ...(keyEnv ? { expectedEnvVar: keyEnv } : {})
        }
      );

      return {
        ...buildRouteForProvider(safeDefault.provider, safeDefault.model, options.providerApiKeys),
        routingSource: 'degraded_default',
        resolvedRouteId: decision.routeId ?? null,
        resolvedExplanation:
          `${keyHint}${missingProviderMessage}. Using the ${safeDefault.provider}/${safeDefault.model} degraded default instead.`,
        resolvedFailureKind: 'no_key_available',
        resolvedStepId: null,
        resolvedOrderIndex: null,
        resolvedSwitchReasonCode: null,
        resolvedEstimatedCostUsd: null,
        resolvedMatchedCriteria: null,
        resolvedFallbackCandidates: decision.fallbackCandidates ?? null,
        resolvedStepChain: decision.stepChain ?? null
      };
    }

    throw new Error(missingProviderMessage);
  }

  let modelId =
    decision.model?.trim() ||
    (options.type === 'extraction'
      ? getDefaultExtractionModelId(decision.provider)
      : getDefaultReasoningModelId(decision.provider, depthMode, pass));

  const providerCatalog = uniqueModelIds(DEFAULT_MODEL_CATALOG[decision.provider] ?? []);
  const hasExplicitModelSelection = Boolean(options.requestedModelId?.trim());
  const modelInCatalog = providerCatalog.includes(modelId);
  if (
    options.type === 'reasoning' &&
    decision.provider === 'anthropic' &&
    decision.source === 'restormel' &&
    !hasExplicitModelSelection &&
    providerCatalog.length > 0 &&
    !modelInCatalog
  ) {
    const fallbackModel = getDefaultReasoningModelId(decision.provider, depthMode, pass);
    console.warn(
      '[restormel] Selected model is not in Sophia catalog; using provider default',
      {
        routeId: decision.routeId,
        provider: decision.provider,
        selectedModel: modelId,
        fallbackModel
      }
    );
    if (decision.routeId) {
      void restormelPostCatalogObservation({
        providerType: decision.provider,
        modelId,
        observationType: 'retirement',
        reason: 'restormel_resolve_selected_model_missing_from_sophia_catalog',
        source: 'sophia-routing',
        routeId: decision.routeId
      }).catch((error) => {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(
            '[restormel] Failed posting catalog observation:',
            error instanceof Error ? error.message : String(error)
          );
        }
      });
    }
    modelId = fallbackModel;
  }

  return {
    ...buildRouteForProvider(decision.provider, modelId, options.providerApiKeys),
    routingSource: decision.source,
    resolvedRouteId: decision.routeId ?? null,
    resolvedExplanation: decision.explanation ?? null,
    resolvedFailureKind: decision.failureKind,
    resolvedStepId: decision.selectedStepId ?? null,
    resolvedOrderIndex: decision.selectedOrderIndex ?? null,
    resolvedSwitchReasonCode: decision.switchReasonCode ?? null,
    resolvedEstimatedCostUsd: decision.estimatedCostUsd ?? null,
    resolvedMatchedCriteria: decision.matchedCriteria ?? null,
    resolvedFallbackCandidates: decision.fallbackCandidates ?? null,
    resolvedStepChain: decision.stepChain ?? null
  };
}

export async function resolveReasoningModelRoute(options?: {
  depthMode?: 'quick' | 'standard' | 'deep';
  pass?: RoutingPass;
  requestedProvider?: RequestedProvider;
  requestedModelId?: string;
  providerApiKeys?: ProviderApiKeys;
  routeId?: string;
  failureMode?: 'degraded_default' | 'error';
  restormelContext?: RouteRestormelContext;
}): Promise<ReasoningModelRoute> {
  return resolveRoute({
    type: 'reasoning',
    ...options
  });
}

export async function resolveExtractionModelRoute(options?: {
  requestedProvider?: RequestedProvider;
  requestedModelId?: string;
  providerApiKeys?: ProviderApiKeys;
  routeId?: string;
  failureMode?: 'degraded_default' | 'error';
  restormelContext?: RouteRestormelContext;
}): Promise<ReasoningModelRoute> {
  return resolveRoute({
    type: 'extraction',
    pass: 'generic',
    depthMode: 'standard',
    requestedProvider: options?.requestedProvider ?? 'auto',
    requestedModelId: options?.requestedModelId,
    providerApiKeys: options?.providerApiKeys,
    routeId: options?.routeId,
    failureMode: options?.failureMode ?? 'error',
    restormelContext: options?.restormelContext
  });
}

export function getAvailableReasoningModels(options?: {
  providerApiKeys?: ProviderApiKeys;
  includePlatformProviders?: boolean;
  allowedProviders?: ReasoningProvider[];
}): AvailableModelOption[] {
  const includePlatformProviders = options?.includePlatformProviders ?? true;
  const allowedProviders = new Set(options?.allowedProviders ?? REASONING_PROVIDER_ORDER);
  const optionsOut: AvailableModelOption[] = [];

  for (const provider of REASONING_PROVIDER_ORDER) {
    if (!allowedProviders.has(provider)) continue;

    const byokKey = options?.providerApiKeys?.[provider]?.trim();
    const canUseByok = Boolean(byokKey);
    const canUsePlatform =
      includePlatformProviders && Boolean(getPlatformApiKey(provider));

    if (!canUseByok && !canUsePlatform) continue;

    const catalog = uniqueModelIds(DEFAULT_MODEL_CATALOG[provider]);
    const providerLabel = getModelProviderLabel(provider);
    for (const id of catalog) {
      optionsOut.push({
        id,
        provider,
        label: `${providerLabel} · ${id}`,
        description: canUseByok && !canUsePlatform
          ? `User BYOK ${providerLabel} model`
          : canUseByok
            ? `${providerLabel} model (platform or your BYOK key)`
            : `${providerLabel} model`,
        credential_source: canUseByok && !canUsePlatform ? 'byok' : 'platform'
      });
    }
  }

  return optionsOut;
}

let sessionTokens = {
  input: 0,
  output: 0
};

export function trackTokens(inputTokens: number, outputTokens: number): void {
  sessionTokens.input += inputTokens;
  sessionTokens.output += outputTokens;

  console.log(`[Tokens] Input: ${inputTokens} | Output: ${outputTokens}`);
  console.log(`[Session] Input: ${sessionTokens.input} | Output: ${sessionTokens.output}`);
}

