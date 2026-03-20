import { createVertex } from '@ai-sdk/google-vertex';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import {
  DEFAULT_MODEL_CATALOG,
  REASONING_PROVIDER_BASE_URL_ENV,
  REASONING_PROVIDER_DEFAULT_BASE_URL,
  REASONING_PROVIDER_ORDER,
  REASONING_PROVIDER_PLATFORM_API_KEY_ENV,
  getModelProviderLabel,
  type ModelProvider,
  type ReasoningProvider
} from '@restormel/contracts/providers';
import { loadServerEnv } from './env';
import type { ProviderApiKeys } from './byok/types';
import { resolveProviderDecision, type ResolveFailureKind } from './resolve-provider';

// Lazy initialization - create vertex client only when first called
let vertexInstance: ReturnType<typeof createVertex> | null = null;

function initializeVertex() {
  if (vertexInstance) return vertexInstance;
  loadServerEnv();

  const project =
    process.env.GOOGLE_VERTEX_PROJECT ||
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.VITE_FIREBASE_PROJECT_ID;
  const location = process.env.GOOGLE_VERTEX_LOCATION || process.env.GCP_LOCATION || 'us-central1';

  console.log(`[Vertex] Initializing — project=${project ?? '(missing)'} location=${location}`);

  if (!project) {
    console.error('[Vertex] FATAL: No project ID found. Checked: GOOGLE_VERTEX_PROJECT, GCP_PROJECT_ID, GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT, VITE_FIREBASE_PROJECT_ID');
    throw new Error('Vertex AI project ID is required. Set GOOGLE_VERTEX_PROJECT or GCP_PROJECT_ID environment variable.');
  }

  try {
    vertexInstance = createVertex({ project, location });
    console.log(`[Vertex] Client created successfully — project=${project} location=${location}`);
  } catch (err) {
    console.error('[Vertex] createVertex() threw:', err instanceof Error ? err.stack : String(err));
    throw err;
  }

  return vertexInstance;
}

function getVertex() {
  return initializeVertex();
}

let anthropicInstance: ReturnType<typeof createAnthropic> | null = null;
const anthropicByApiKey = new Map<string, ReturnType<typeof createAnthropic>>();
const googleByApiKey = new Map<string, ReturnType<typeof createGoogleGenerativeAI>>();
const openAICompatibleByCacheKey = new Map<string, ReturnType<typeof createOpenAI>>();

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

function getGoogleForApiKey(apiKey: string) {
  const existing = googleByApiKey.get(apiKey);
  if (existing) return existing;
  const instance = createGoogleGenerativeAI({ apiKey });
  googleByApiKey.set(apiKey, instance);
  return instance;
}

function getPlatformApiKey(provider: ReasoningProvider): string | undefined {
  if (provider === 'vertex') return undefined;
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  const envName = REASONING_PROVIDER_PLATFORM_API_KEY_ENV[provider];
  if (!envName) return undefined;
  return process.env[envName]?.trim() || undefined;
}

function getProviderBaseUrl(provider: Exclude<ReasoningProvider, 'vertex' | 'anthropic'>): string | undefined {
  const envName = REASONING_PROVIDER_BASE_URL_ENV[provider];
  const fromEnv = envName ? process.env[envName]?.trim() : undefined;
  return fromEnv || REASONING_PROVIDER_DEFAULT_BASE_URL[provider];
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
  supportsGrounding: boolean;
  credentialSource: 'byok' | 'platform';
  routingSource?: 'restormel' | 'requested' | 'degraded_default';
  resolvedRouteId?: string | null;
  resolvedExplanation?: string | null;
  resolvedFailureKind?: ResolveFailureKind;
}

export interface AvailableModelOption {
  id: string;
  provider: ReasoningProvider;
  label: string;
  description: string;
  credential_source?: 'byok' | 'platform';
}

const DEFAULT_STANDARD_PROVIDER: ReasoningProvider = 'vertex';
const DEFAULT_STANDARD_MODEL_ID =
  DEFAULT_MODEL_CATALOG.vertex[1] ?? DEFAULT_MODEL_CATALOG.vertex[0] ?? 'gemini-2.5-flash';
const DEFAULT_DEEP_MODEL_ID =
  DEFAULT_MODEL_CATALOG.vertex[0] ?? DEFAULT_STANDARD_MODEL_ID;
const DEFAULT_EXTRACTION_MODEL_ID = DEFAULT_STANDARD_MODEL_ID;

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
    return provider === 'vertex' ? DEFAULT_STANDARD_MODEL_ID : DEFAULT_STANDARD_MODEL_ID;
  }

  if (provider === 'vertex') {
    return depthMode === 'deep' || pass === 'verification'
      ? DEFAULT_DEEP_MODEL_ID
      : DEFAULT_STANDARD_MODEL_ID;
  }

  if (provider === 'anthropic') {
    if (depthMode === 'deep') {
      return catalog[0] ?? catalog[1] ?? DEFAULT_STANDARD_MODEL_ID;
    }
    return catalog[1] ?? catalog[0] ?? DEFAULT_STANDARD_MODEL_ID;
  }

  return catalog[0] ?? DEFAULT_STANDARD_MODEL_ID;
}

function getDefaultExtractionModelId(provider: ReasoningProvider): string {
  if (provider === 'vertex') return DEFAULT_EXTRACTION_MODEL_ID;
  return DEFAULT_MODEL_CATALOG[provider][0] ?? DEFAULT_STANDARD_MODEL_ID;
}

function buildVertexRoute(modelId: string, byokVertexKey?: string): ReasoningModelRoute {
  if (byokVertexKey) {
    return {
      model: getGoogleForApiKey(byokVertexKey)(modelId),
      provider: 'vertex',
      modelId,
      supportsGrounding: false,
      credentialSource: 'byok'
    };
  }

  return {
    model: getVertex()(modelId),
    provider: 'vertex',
    modelId,
    supportsGrounding: true,
    credentialSource: 'platform'
  };
}

function buildAnthropicRoute(modelId: string, byokAnthropicKey?: string): ReasoningModelRoute {
  if (byokAnthropicKey) {
    return {
      model: getAnthropicForApiKey(byokAnthropicKey)(modelId),
      provider: 'anthropic',
      modelId,
      supportsGrounding: false,
      credentialSource: 'byok'
    };
  }

  return {
    model: getAnthropicForApiKey()(modelId),
    provider: 'anthropic',
    modelId,
    supportsGrounding: false,
    credentialSource: 'platform'
  };
}

function buildOpenAICompatibleRoute(
  provider: Exclude<ReasoningProvider, 'vertex' | 'anthropic'>,
  modelId: string,
  apiKey?: string
): ReasoningModelRoute {
  return {
    model: getOpenAICompatibleForProvider(provider, apiKey)(modelId),
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
  return buildOpenAICompatibleRoute(provider, modelId, byokKey);
}

function hasProviderAccess(
  provider: ReasoningProvider,
  providerApiKeys?: ProviderApiKeys
): boolean {
  if (providerApiKeys?.[provider]?.trim()) return true;
  if (provider === 'vertex') return true;
  return Boolean(getPlatformApiKey(provider));
}

function buildSafeDefaultDecision(
  type: 'reasoning' | 'extraction',
  depthMode: 'quick' | 'standard' | 'deep',
  pass: RoutingPass
): { provider: ReasoningProvider; model: string; explanation: string } {
  const provider = DEFAULT_STANDARD_PROVIDER;
  const model =
    type === 'extraction'
      ? getDefaultExtractionModelId(provider)
      : getDefaultReasoningModelId(provider, depthMode, pass);

  return {
    provider,
    model,
    explanation: `Restormel resolve was unavailable, so Sophia used the ${provider}/${model} degraded default.`
  };
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
}): Promise<ReasoningModelRoute> {
  const depthMode = options.depthMode ?? 'standard';
  const pass = options.pass ?? 'generic';
  const safeDefault = buildSafeDefaultDecision(options.type, depthMode, pass);
  const decision = await resolveProviderDecision({
    preferredProvider: options.requestedProvider,
    preferredModel: options.requestedModelId,
    routeId: options.routeId,
    safeDefault,
    failureMode: options.failureMode ?? 'degraded_default'
  });

  if (!hasProviderAccess(decision.provider, options.providerApiKeys)) {
    throw new Error(
      `${decision.provider} provider requested but no BYOK key or platform API key is configured`
    );
  }

  const modelId =
    decision.model?.trim() ||
    (options.type === 'extraction'
      ? getDefaultExtractionModelId(decision.provider)
      : getDefaultReasoningModelId(decision.provider, depthMode, pass));

  return {
    ...buildRouteForProvider(decision.provider, modelId, options.providerApiKeys),
    routingSource: decision.source,
    resolvedRouteId: decision.routeId ?? null,
    resolvedExplanation: decision.explanation ?? null,
    resolvedFailureKind: decision.failureKind
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
}): Promise<ReasoningModelRoute> {
  return resolveRoute({
    type: 'extraction',
    pass: 'generic',
    depthMode: 'standard',
    requestedProvider: options?.requestedProvider ?? 'auto',
    requestedModelId: options?.requestedModelId,
    providerApiKeys: options?.providerApiKeys,
    routeId: options?.routeId,
    failureMode: options?.failureMode ?? 'error'
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
      includePlatformProviders && (provider === 'vertex' ? true : Boolean(getPlatformApiKey(provider)));

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

/**
 * Get Google Search grounding tool from the Vertex AI provider.
 */
export function getGroundingTool() {
  return getVertex().tools.googleSearch({});
}
