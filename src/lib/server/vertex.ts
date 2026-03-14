import { createVertex } from '@ai-sdk/google-vertex';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { loadServerEnv } from './env';
import type { ProviderApiKeys } from './byok/types';
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

function getOpenAICompatibleForProvider(provider: Exclude<ReasoningProvider, 'vertex' | 'anthropic'>, apiKey?: string) {
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

interface RuntimeRoutingConfig {
  reasoningModelId: string;
  extractionModelId: string;
  deepReasoningModelId: string;
  deepAnalysisModelId: string;
  deepCritiqueModelId: string;
  deepSynthesisModelId: string;
  deepVerificationModelId: string;
  deepRoutingEnabled: boolean;
  deepProvider: ReasoningProvider;
  deepModelPasses: Set<string>;
  providerReasoningModelIds: Partial<Record<Exclude<ReasoningProvider, 'vertex'>, string>>;
  providerDeepModelIds: Partial<Record<Exclude<ReasoningProvider, 'vertex'>, string>>;
  providerExtractionModelIds: Partial<Record<Exclude<ReasoningProvider, 'vertex'>, string>>;
  platformProviderEnabled: Partial<Record<ReasoningProvider, boolean>>;
}

function envModelId(provider: Exclude<ReasoningProvider, 'vertex'>, kind: 'REASONING_MODEL' | 'DEEP_MODEL' | 'EXTRACTION_MODEL'): string | undefined {
  const prefix = provider.toUpperCase();
  return process.env[`${prefix}_${kind}`]?.trim() || undefined;
}

function getRuntimeRoutingConfig(): RuntimeRoutingConfig {
  loadServerEnv();
  const reasoningModelId = process.env.GEMINI_REASONING_MODEL || 'gemini-2.5-flash';
  const extractionModelId = process.env.GEMINI_EXTRACTION_MODEL || 'gemini-2.5-flash';
  const deepReasoningModelId = process.env.GEMINI_DEEP_REASONING_MODEL || 'gemini-2.5-pro';
  const deepAnalysisModelId = process.env.GEMINI_DEEP_ANALYSIS_MODEL || deepReasoningModelId;
  const deepCritiqueModelId = process.env.GEMINI_DEEP_CRITIQUE_MODEL || deepReasoningModelId;
  const deepSynthesisModelId = process.env.GEMINI_DEEP_SYNTHESIS_MODEL || deepReasoningModelId;
  const deepVerificationModelId = process.env.GEMINI_DEEP_VERIFICATION_MODEL || deepReasoningModelId;
  const deepRoutingEnabled = (process.env.ENABLE_DEEP_MODEL_ROUTING ?? 'true').toLowerCase() === 'true';
  const deepProvider =
    isReasoningProvider(process.env.DEEP_MODEL_PROVIDER)
      ? (process.env.DEEP_MODEL_PROVIDER!.toLowerCase() as ReasoningProvider)
      : 'vertex';
  const deepModelPasses = new Set(
    (process.env.DEEP_MODEL_PASSES ?? 'critique,synthesis')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  const providerReasoningModelIds: Partial<Record<Exclude<ReasoningProvider, 'vertex'>, string>> = {};
  const providerDeepModelIds: Partial<Record<Exclude<ReasoningProvider, 'vertex'>, string>> = {};
  const providerExtractionModelIds: Partial<Record<Exclude<ReasoningProvider, 'vertex'>, string>> = {};
  const platformProviderEnabled: Partial<Record<ReasoningProvider, boolean>> = {
    vertex: true
  };

  for (const provider of REASONING_PROVIDER_ORDER) {
    if (provider === 'vertex') continue;

    const defaults = DEFAULT_MODEL_CATALOG[provider];
    if (provider === 'anthropic') {
      const reasoning = envModelId(provider, 'REASONING_MODEL') || process.env.CLAUDE_MODEL || defaults[1] || defaults[0];
      const deep = envModelId(provider, 'DEEP_MODEL') || process.env.ANTHROPIC_DEEP_MODEL || reasoning;
      providerReasoningModelIds[provider] = reasoning;
      providerDeepModelIds[provider] = deep;
      providerExtractionModelIds[provider] = envModelId(provider, 'EXTRACTION_MODEL') || reasoning;
      platformProviderEnabled[provider] = !!process.env.ANTHROPIC_API_KEY;
      continue;
    }

    const reasoning = envModelId(provider, 'REASONING_MODEL') || defaults[0];
    const deep = envModelId(provider, 'DEEP_MODEL') || reasoning;
    const extraction = envModelId(provider, 'EXTRACTION_MODEL') || reasoning;
    providerReasoningModelIds[provider] = reasoning;
    providerDeepModelIds[provider] = deep;
    providerExtractionModelIds[provider] = extraction;
    platformProviderEnabled[provider] = !!getPlatformApiKey(provider);
  }

  return {
    reasoningModelId,
    extractionModelId,
    deepReasoningModelId,
    deepAnalysisModelId,
    deepCritiqueModelId,
    deepSynthesisModelId,
    deepVerificationModelId,
    deepRoutingEnabled,
    deepProvider,
    deepModelPasses,
    providerReasoningModelIds,
    providerDeepModelIds,
    providerExtractionModelIds,
    platformProviderEnabled
  };
}

type RoutingPass = 'analysis' | 'critique' | 'synthesis' | 'verification' | 'generic';
type RequestedProvider = ModelProvider;

export interface ReasoningModelRoute {
  model: any;
  provider: ReasoningProvider;
  modelId: string;
  supportsGrounding: boolean;
  credentialSource: 'byok' | 'platform';
}

export interface AvailableModelOption {
  id: string;
  provider: ReasoningProvider;
  label: string;
  description: string;
  credential_source?: 'byok' | 'platform';
}

function parseCatalog(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function uniqueModelIds(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const modelId = value?.trim();
    if (!modelId) continue;
    if (seen.has(modelId)) continue;
    seen.add(modelId);
    out.push(modelId);
  }
  return out;
}

function getProviderModelCatalog(
  provider: ReasoningProvider,
  config: RuntimeRoutingConfig,
  pass?: RoutingPass
): string[] {
  if (provider === 'vertex') {
    return uniqueModelIds([
      config.reasoningModelId,
      config.deepReasoningModelId,
      config.deepAnalysisModelId,
      config.deepCritiqueModelId,
      config.deepSynthesisModelId,
      config.deepVerificationModelId,
      ...parseCatalog(process.env.VERTEX_MODEL_CATALOG),
      ...DEFAULT_MODEL_CATALOG.vertex
    ]);
  }

  const prefix = provider.toUpperCase();
  const reasoning = config.providerReasoningModelIds[provider];
  const deep = config.providerDeepModelIds[provider] || reasoning;
  let passSpecific: Array<string | undefined> = [];
  if (provider === 'anthropic') {
    if (pass && pass !== 'generic') {
      passSpecific = [
        pass === 'analysis' ? process.env.ANTHROPIC_DEEP_ANALYSIS_MODEL : undefined,
        pass === 'critique' ? process.env.ANTHROPIC_DEEP_CRITIQUE_MODEL : undefined,
        pass === 'synthesis' ? process.env.ANTHROPIC_DEEP_SYNTHESIS_MODEL : undefined,
        pass === 'verification' ? process.env.ANTHROPIC_DEEP_VERIFICATION_MODEL : undefined
      ];
    }
  }

  return uniqueModelIds([
    reasoning,
    deep,
    ...passSpecific,
    ...parseCatalog(process.env[`${prefix}_MODEL_CATALOG`]),
    ...DEFAULT_MODEL_CATALOG[provider]
  ]);
}

export function getReasoningModel(options?: {
  providerApiKeys?: ProviderApiKeys;
  requestedProvider?: RequestedProvider;
}) {
  const route = getReasoningModelRoute({
    pass: 'generic',
    requestedProvider: options?.requestedProvider,
    providerApiKeys: options?.providerApiKeys
  });
  return route.model;
}

export function getExtractionModel(options?: {
  providerApiKeys?: ProviderApiKeys;
}) {
  const config = getRuntimeRoutingConfig();

  const byokVertexKey = options?.providerApiKeys?.vertex?.trim();
  if (byokVertexKey) {
    return getGoogleForApiKey(byokVertexKey)(config.extractionModelId);
  }

  for (const provider of REASONING_PROVIDER_ORDER) {
    if (provider === 'vertex') continue;
    const key = options?.providerApiKeys?.[provider]?.trim();
    if (!key) continue;

    if (provider === 'anthropic') {
      return getAnthropicForApiKey(key)(config.providerExtractionModelIds.anthropic || config.providerReasoningModelIds.anthropic!);
    }

    return getOpenAICompatibleForProvider(provider, key)(
      config.providerExtractionModelIds[provider] || config.providerReasoningModelIds[provider]!
    );
  }

  return getVertex()(config.extractionModelId);
}

function getDeepVertexModelId(config: RuntimeRoutingConfig, pass: RoutingPass): string {
  if (pass === 'analysis') return config.deepAnalysisModelId;
  if (pass === 'critique') return config.deepCritiqueModelId;
  if (pass === 'synthesis') return config.deepSynthesisModelId;
  if (pass === 'verification') return config.deepVerificationModelId;
  return config.deepReasoningModelId;
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

function getRouteForProvider(
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
  config: RuntimeRoutingConfig,
  providerApiKeys?: ProviderApiKeys
): boolean {
  const byokKey = providerApiKeys?.[provider]?.trim();
  if (byokKey) return true;
  if (provider === 'vertex') return true;
  return !!config.platformProviderEnabled[provider];
}

function getReasoningModelIdForProvider(provider: ReasoningProvider, config: RuntimeRoutingConfig): string {
  if (provider === 'vertex') return config.reasoningModelId;
  return config.providerReasoningModelIds[provider] || DEFAULT_MODEL_CATALOG[provider][0];
}

function getDeepModelIdForProvider(provider: ReasoningProvider, config: RuntimeRoutingConfig, pass: RoutingPass): string {
  if (provider === 'vertex') return getDeepVertexModelId(config, pass);

  if (provider === 'anthropic') {
    if (pass === 'analysis') return process.env.ANTHROPIC_DEEP_ANALYSIS_MODEL || config.providerDeepModelIds.anthropic || config.providerReasoningModelIds.anthropic!;
    if (pass === 'critique') return process.env.ANTHROPIC_DEEP_CRITIQUE_MODEL || config.providerDeepModelIds.anthropic || config.providerReasoningModelIds.anthropic!;
    if (pass === 'synthesis') return process.env.ANTHROPIC_DEEP_SYNTHESIS_MODEL || config.providerDeepModelIds.anthropic || config.providerReasoningModelIds.anthropic!;
    if (pass === 'verification') return process.env.ANTHROPIC_DEEP_VERIFICATION_MODEL || config.providerDeepModelIds.anthropic || config.providerReasoningModelIds.anthropic!;
  }

  return config.providerDeepModelIds[provider] || config.providerReasoningModelIds[provider] || DEFAULT_MODEL_CATALOG[provider][0];
}

export function getReasoningModelRoute(options?: {
  depthMode?: 'quick' | 'standard' | 'deep';
  pass?: RoutingPass;
  requestedProvider?: RequestedProvider;
  requestedModelId?: string;
  providerApiKeys?: ProviderApiKeys;
}): ReasoningModelRoute {
  const config = getRuntimeRoutingConfig();
  const depthMode = options?.depthMode ?? 'standard';
  const pass = options?.pass ?? 'generic';
  const requestedProvider = options?.requestedProvider ?? 'auto';
  const requestedModelId = options?.requestedModelId?.trim();

  if (requestedProvider !== 'auto') {
    if (!hasProviderAccess(requestedProvider, config, options?.providerApiKeys)) {
      throw new Error(`${requestedProvider} provider requested but no BYOK key or platform API key is configured`);
    }
    const modelId =
      requestedModelId ||
      (depthMode === 'deep'
        ? getDeepModelIdForProvider(requestedProvider, config, pass)
        : getReasoningModelIdForProvider(requestedProvider, config));
    return getRouteForProvider(requestedProvider, modelId, options?.providerApiKeys);
  }

  const shouldEscalate =
    depthMode === 'deep' &&
    config.deepRoutingEnabled &&
    config.deepModelPasses.has(pass);

  if (!shouldEscalate) {
    const autoPriority: ReasoningProvider[] = [
      'vertex',
      'openai',
      'xai',
      'groq',
      'mistral',
      'deepseek',
      'together',
      'openrouter',
      'perplexity',
      'anthropic'
    ];
    for (const provider of autoPriority) {
      const key = options?.providerApiKeys?.[provider]?.trim();
      if (provider === 'vertex' && !key) continue;
      if (!key) continue;
      return getRouteForProvider(provider, getReasoningModelIdForProvider(provider, config), options?.providerApiKeys);
    }
    return buildVertexRoute(config.reasoningModelId);
  }

  if (hasProviderAccess(config.deepProvider, config, options?.providerApiKeys)) {
    return getRouteForProvider(
      config.deepProvider,
      getDeepModelIdForProvider(config.deepProvider, config, pass),
      options?.providerApiKeys
    );
  }

  for (const provider of REASONING_PROVIDER_ORDER) {
    if (provider === 'vertex') continue;
    const key = options?.providerApiKeys?.[provider]?.trim();
    if (!key) continue;
    return getRouteForProvider(provider, getDeepModelIdForProvider(provider, config, pass), options?.providerApiKeys);
  }

  return buildVertexRoute(getDeepVertexModelId(config, pass));
}

export function getAvailableReasoningModels(options?: {
  providerApiKeys?: ProviderApiKeys;
  includePlatformProviders?: boolean;
  allowedProviders?: ReasoningProvider[];
}): AvailableModelOption[] {
  const config = getRuntimeRoutingConfig();
  const includePlatformProviders = options?.includePlatformProviders ?? true;
  const allowedProviders = new Set(options?.allowedProviders ?? REASONING_PROVIDER_ORDER);

  const optionsOut: AvailableModelOption[] = [];

  for (const provider of REASONING_PROVIDER_ORDER) {
    if (!allowedProviders.has(provider)) continue;

    const byokKey = options?.providerApiKeys?.[provider]?.trim();
    const canUseByok = !!byokKey;
    const canUsePlatform = includePlatformProviders && (provider === 'vertex' ? true : !!config.platformProviderEnabled[provider]);

    if (!canUseByok && !canUsePlatform) continue;

    const catalog = getProviderModelCatalog(provider, config);
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
