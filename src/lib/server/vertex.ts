import { createVertex } from '@ai-sdk/google-vertex';
import { createAnthropic } from '@ai-sdk/anthropic';
import { loadServerEnv } from './env';

// Lazy initialization - create vertex client only when first called
let vertexInstance: ReturnType<typeof createVertex> | null = null;

function initializeVertex() {
  if (vertexInstance) return vertexInstance;
  loadServerEnv();

  // Use process.env directly for compatibility with both SvelteKit and standalone scripts
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

function getAnthropic() {
  if (anthropicInstance) return anthropicInstance;
  loadServerEnv();
  anthropicInstance = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });
  return anthropicInstance;
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
  deepProvider: 'vertex' | 'anthropic';
  anthropicDeepModelId: string;
  deepModelPasses: Set<string>;
  anthropicApiEnabled: boolean;
}

function getRuntimeRoutingConfig(): RuntimeRoutingConfig {
  loadServerEnv();
  const reasoningModelId = process.env.GEMINI_REASONING_MODEL || 'gemini-2.0-flash';
  const extractionModelId = process.env.GEMINI_EXTRACTION_MODEL || 'gemini-2.0-flash';
  const deepReasoningModelId = process.env.GEMINI_DEEP_REASONING_MODEL || reasoningModelId;
  const deepAnalysisModelId = process.env.GEMINI_DEEP_ANALYSIS_MODEL || deepReasoningModelId;
  const deepCritiqueModelId = process.env.GEMINI_DEEP_CRITIQUE_MODEL || deepReasoningModelId;
  const deepSynthesisModelId = process.env.GEMINI_DEEP_SYNTHESIS_MODEL || deepReasoningModelId;
  const deepVerificationModelId = process.env.GEMINI_DEEP_VERIFICATION_MODEL || deepReasoningModelId;
  const deepRoutingEnabled = (process.env.ENABLE_DEEP_MODEL_ROUTING ?? 'true').toLowerCase() === 'true';
  const deepProvider = ((process.env.DEEP_MODEL_PROVIDER ?? 'vertex').toLowerCase() === 'anthropic'
    ? 'anthropic'
    : 'vertex') as 'vertex' | 'anthropic';
  const anthropicDeepModelId = process.env.ANTHROPIC_DEEP_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
  const deepModelPasses = new Set(
    (process.env.DEEP_MODEL_PASSES ?? 'critique,synthesis')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

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
    anthropicDeepModelId,
    deepModelPasses,
    anthropicApiEnabled: !!process.env.ANTHROPIC_API_KEY
  };
}

type RoutingPass = 'analysis' | 'critique' | 'synthesis' | 'verification' | 'generic';
type RequestedProvider = 'auto' | 'vertex' | 'anthropic';

export interface ReasoningModelRoute {
  model: ReturnType<ReturnType<typeof createVertex>> | ReturnType<ReturnType<typeof createAnthropic>>;
  provider: 'vertex' | 'anthropic';
  modelId: string;
  supportsGrounding: boolean;
}

export interface AvailableModelOption {
  id: string;
  provider: 'vertex' | 'anthropic';
  label: string;
  description: string;
}

export function getReasoningModel() {
  const config = getRuntimeRoutingConfig();
  return getVertex()(config.reasoningModelId);
}

export function getExtractionModel() {
  const config = getRuntimeRoutingConfig();
  return getVertex()(config.extractionModelId);
}

function getDeepVertexModelId(config: RuntimeRoutingConfig, pass: RoutingPass): string {
  if (pass === 'analysis') return config.deepAnalysisModelId;
  if (pass === 'critique') return config.deepCritiqueModelId;
  if (pass === 'synthesis') return config.deepSynthesisModelId;
  if (pass === 'verification') return config.deepVerificationModelId;
  return config.deepReasoningModelId;
}

export function getReasoningModelRoute(options?: {
  depthMode?: 'quick' | 'standard' | 'deep';
  pass?: RoutingPass;
  requestedProvider?: RequestedProvider;
  requestedModelId?: string;
}): ReasoningModelRoute {
  const config = getRuntimeRoutingConfig();
  const depthMode = options?.depthMode ?? 'standard';
  const pass = options?.pass ?? 'generic';
  const requestedProvider = options?.requestedProvider ?? 'auto';
  const requestedModelId = options?.requestedModelId?.trim();

  if (requestedProvider === 'anthropic') {
    if (!config.anthropicApiEnabled) {
      throw new Error('Anthropic provider requested but ANTHROPIC_API_KEY is not configured');
    }
    return {
      model: getAnthropic()(requestedModelId || config.anthropicDeepModelId),
      provider: 'anthropic',
      modelId: requestedModelId || config.anthropicDeepModelId,
      supportsGrounding: false
    };
  }

  if (requestedProvider === 'vertex') {
    const modelId = requestedModelId || (depthMode === 'deep' ? getDeepVertexModelId(config, pass) : config.reasoningModelId);
    return {
      model: getVertex()(modelId),
      provider: 'vertex',
      modelId,
      supportsGrounding: true
    };
  }

  const shouldEscalate =
    depthMode === 'deep' &&
    config.deepRoutingEnabled &&
    config.deepModelPasses.has(pass);

  if (!shouldEscalate) {
    return {
      model: getVertex()(config.reasoningModelId),
      provider: 'vertex',
      modelId: config.reasoningModelId,
      supportsGrounding: true
    };
  }

  if (config.deepProvider === 'anthropic' && config.anthropicApiEnabled) {
    return {
      model: getAnthropic()(config.anthropicDeepModelId),
      provider: 'anthropic',
      modelId: config.anthropicDeepModelId,
      supportsGrounding: false
    };
  }

  const modelId = getDeepVertexModelId(config, pass);
  return {
    model: getVertex()(modelId),
    provider: 'vertex',
    modelId,
    supportsGrounding: true
  };
}

export function getAvailableReasoningModels(): AvailableModelOption[] {
  const config = getRuntimeRoutingConfig();
  const options: AvailableModelOption[] = [
    {
      id: config.reasoningModelId,
      provider: 'vertex',
      label: `Gemini · ${config.reasoningModelId}`,
      description: 'Vertex reasoning model'
    }
  ];

  const deepVertex = [config.deepAnalysisModelId, config.deepCritiqueModelId, config.deepSynthesisModelId, config.deepVerificationModelId]
    .filter((id, idx, arr) => !!id && arr.indexOf(id) === idx && id !== config.reasoningModelId);
  for (const id of deepVertex) {
    options.push({
      id,
      provider: 'vertex',
      label: `Gemini · ${id}`,
      description: 'Vertex deep routing model'
    });
  }

  if (config.anthropicApiEnabled) {
    options.push({
      id: config.anthropicDeepModelId,
      provider: 'anthropic',
      label: `Claude · ${config.anthropicDeepModelId}`,
      description: 'Anthropic reasoning model'
    });
  }

  return options;
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
