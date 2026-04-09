import { createGoogleGenerativeAI } from '@ai-sdk/google';
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
  type ModelProvider,
  type ReasoningProvider
} from '@restormel/contracts/providers';
import { loadServerEnv } from './env';
import type { ProviderApiKeys } from './byok/types';
import {
  restormelPostCatalogObservation,
  type RestormelFallbackCandidate,
  type RestormelStepChainEntry
} from './restormel';
import { resolveProviderDecision, type ResolveFailureKind } from './resolve-provider';

let anthropicInstance: ReturnType<typeof createAnthropic> | null = null;
const anthropicByApiKey = new Map<string, ReturnType<typeof createAnthropic>>();
const googleByApiKey = new Map<string, ReturnType<typeof createGoogleGenerativeAI>>();
const openAICompatibleByCacheKey = new Map<string, ReturnType<typeof createOpenAI>>();
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

function getGoogleForApiKey(apiKey: string) {
  const existing = googleByApiKey.get(apiKey);
  if (existing) return existing;
  const instance = createGoogleGenerativeAI({ apiKey });
  googleByApiKey.set(apiKey, instance);
  return instance;
}

function getPlatformApiKey(provider: ReasoningProvider): string | undefined {
  const envName = REASONING_PROVIDER_PLATFORM_API_KEY_ENV[provider];
  if (!envName) return undefined;
  return process.env[envName]?.trim() || undefined;
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
  DEFAULT_MODEL_CATALOG.vertex.find((id) => id.includes('flash') && id.includes('2.5')) ??
  DEFAULT_MODEL_CATALOG.vertex[1] ??
  'gemini-2.5-flash';
const VERTEX_DEGRADED_DEEP_MODEL =
  DEFAULT_MODEL_CATALOG.vertex.find((id) => id.includes('2.5-pro')) ??
  DEFAULT_MODEL_CATALOG.vertex[0] ??
  'gemini-2.5-pro';

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
  if (byokVertexKey) {
    return {
      model: getGoogleForApiKey(byokVertexKey)(modelId),
      provider: 'vertex',
      modelId,
      supportsGrounding: false,
      credentialSource: 'byok'
    };
  }

  const platformGoogleKey = getPlatformApiKey('vertex');
  if (platformGoogleKey) {
    return {
      model: getGoogleForApiKey(platformGoogleKey)(modelId),
      provider: 'vertex',
      modelId,
      supportsGrounding: false,
      credentialSource: 'platform'
    };
  }

  throw new Error(
    'Gemini (catalog provider `vertex`) requires GOOGLE_AI_API_KEY or a stored Gemini/Google BYOK key. Vertex ADC is not supported.'
  );
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
  const model =
    provider === 'openai'
      ? client(modelId)
      : client.chat(modelId as any);
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
  providerApiKeys?: ProviderApiKeys
): { provider: ReasoningProvider; model: string; explanation: string } {
  for (const provider of DEGRADED_DEFAULT_PROVIDER_ORDER) {
    if (!hasProviderAccess(provider, providerApiKeys)) continue;
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
  restormelContext?: {
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
}): Promise<ReasoningModelRoute> {
  const depthMode = options.depthMode ?? 'standard';
  const pass = options.pass ?? 'generic';
  const safeDefault = buildSafeDefaultDecision(
    options.type,
    depthMode,
    pass,
    options.providerApiKeys
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
      console.warn(
        '[restormel] Selected provider is unavailable locally; using degraded default route',
        {
          routeId: decision.routeId,
          provider: decision.provider,
          model: decision.model,
          selectedStepId: decision.selectedStepId
        }
      );

      return {
        ...buildRouteForProvider(safeDefault.provider, safeDefault.model, options.providerApiKeys),
        routingSource: 'degraded_default',
        resolvedRouteId: decision.routeId ?? null,
        resolvedExplanation:
          `${missingProviderMessage}. Using the ${safeDefault.provider}/${safeDefault.model} degraded default instead.`,
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
  restormelContext?: {
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
  restormelContext?: {
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

