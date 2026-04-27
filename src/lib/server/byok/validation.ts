import {
  REASONING_PROVIDER_BASE_URL_ENV,
  REASONING_PROVIDER_DEFAULT_BASE_URL,
  type ByokProvider,
  type ReasoningProvider
} from '$lib/types/providers';

interface ValidationResult {
  ok: boolean;
  error?: string;
}

export interface AizoloModelProbeResult extends ValidationResult {
  provider: 'aizolo';
  modelId: string;
  endpoint: string;
  status: number;
  rateLimited?: boolean;
  responsePreview?: string;
}

async function validateAnthropic(apiKey: string): Promise<ValidationResult> {
  const response = await fetch('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  });

  if (response.ok) return { ok: true };
  const body = await response.text();
  return { ok: false, error: `anthropic_validation_failed_${response.status}:${body.slice(0, 200)}` };
}

async function validateVertexApiKey(apiKey: string): Promise<ValidationResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { method: 'GET' });
  if (response.ok) return { ok: true };
  const body = await response.text();
  return { ok: false, error: `vertex_validation_failed_${response.status}:${body.slice(0, 200)}` };
}

async function validateBearerModelsEndpoint(
  provider: string,
  apiKey: string,
  url: string,
  extraHeaders?: Record<string, string>
): Promise<ValidationResult> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders
    }
  });
  if (response.ok) return { ok: true };
  const body = await response.text();
  return { ok: false, error: `${provider}_validation_failed_${response.status}:${body.slice(0, 200)}` };
}

function getOpenAICompatibleModelsUrl(provider: ReasoningProvider): string {
  const envName = REASONING_PROVIDER_BASE_URL_ENV[provider];
  const fromEnv = envName ? process.env[envName]?.trim() : '';
  const baseUrl = fromEnv || REASONING_PROVIDER_DEFAULT_BASE_URL[provider] || 'https://api.openai.com/v1';
  return `${baseUrl.replace(/\/+$/, '')}/models`;
}

async function validateOpenAICompatible(provider: ReasoningProvider, apiKey: string): Promise<ValidationResult> {
  const url = getOpenAICompatibleModelsUrl(provider);
  const extraHeaders =
    provider === 'openrouter'
      ? {
          'HTTP-Referer': 'https://usesophia.app',
          'X-Title': 'SOPHIA'
        }
      : undefined;
  return validateBearerModelsEndpoint(provider, apiKey, url, extraHeaders);
}

async function validateVoyage(apiKey: string): Promise<ValidationResult> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: 'BYOK validation probe',
      model: 'voyage-3.5',
      input_type: 'document'
    })
  });
  if (response.ok) return { ok: true };
  const body = await response.text();
  return { ok: false, error: `voyage_validation_failed_${response.status}:${body.slice(0, 200)}` };
}

async function validateCohere(apiKey: string): Promise<ValidationResult> {
  return validateBearerModelsEndpoint('cohere', apiKey, 'https://api.cohere.com/v1/models');
}

export const DEFAULT_AIZOLO_MODEL_PROBE_ID = 'aizolo-gemini-gemini-3-flash-preview';

/** AiZolo is OpenAI-compatible for POST /chat/completions but does not serve GET /v1/models (404 HTML). Validate with a minimal completion. @see https://chat.aizolo.com/api/v1/chat/completions */
function getAizoloChatCompletionsUrl(): string {
  const envName = REASONING_PROVIDER_BASE_URL_ENV.aizolo;
  const fromEnv = envName ? process.env[envName]?.trim() : '';
  const baseUrl =
    fromEnv || REASONING_PROVIDER_DEFAULT_BASE_URL.aizolo || 'https://chat.aizolo.com/api/v1';
  const trimmed = baseUrl.replace(/\/+$/, '');
  // Accept either the base (`https://…/api/v1`) or the full endpoint (`…/api/v1/chat/completions`).
  const normalized = trimmed.replace(/\/chat\/completions$/i, '');
  return `${normalized}/chat/completions`;
}

export async function probeAizoloModelWithApiKey(
  apiKey: string,
  modelId = DEFAULT_AIZOLO_MODEL_PROBE_ID
): Promise<AizoloModelProbeResult> {
  const normalizedKey = apiKey.trim();
  const normalizedModel = modelId.trim();
  const endpoint = getAizoloChatCompletionsUrl();
  if (!normalizedKey) {
    return {
      ok: false,
      provider: 'aizolo',
      modelId: normalizedModel || DEFAULT_AIZOLO_MODEL_PROBE_ID,
      endpoint,
      status: 0,
      error: 'empty_api_key'
    };
  }
  if (!normalizedModel) {
    return {
      ok: false,
      provider: 'aizolo',
      modelId: normalizedModel,
      endpoint,
      status: 0,
      error: 'model_id_required'
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${normalizedKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: normalizedModel,
      messages: [{ role: 'user', content: 'Respond with exactly: ok' }],
      max_tokens: 2,
      temperature: 0
    })
  });

  const body = await response.text();
  const preview = body.slice(0, 500);
  if (response.ok) {
    return {
      ok: true,
      provider: 'aizolo',
      modelId: normalizedModel,
      endpoint,
      status: response.status,
      responsePreview: preview || undefined
    };
  }
  if (response.status === 429) {
    return {
      ok: true,
      provider: 'aizolo',
      modelId: normalizedModel,
      endpoint,
      status: response.status,
      rateLimited: true,
      responsePreview: preview || undefined
    };
  }

  return {
    ok: false,
    provider: 'aizolo',
    modelId: normalizedModel,
    endpoint,
    status: response.status,
    error: `aizolo_model_probe_failed_${response.status}:${preview}`,
    responsePreview: preview || undefined
  };
}

async function validateAizolo(apiKey: string): Promise<ValidationResult> {
  const probe = await probeAizoloModelWithApiKey(apiKey, 'openai/gpt-4o-mini');
  if (probe.ok) return { ok: true };
  return {
    ok: false,
    error: probe.error?.replace('aizolo_model_probe_failed_', 'aizolo_validation_failed_') ?? 'aizolo_validation_failed'
  };
}

export async function validateProviderApiKey(provider: ByokProvider, apiKey: string): Promise<ValidationResult> {
  const normalized = apiKey.trim();
  if (!normalized) {
    return { ok: false, error: 'empty_api_key' };
  }

  if (provider === 'anthropic') {
    return validateAnthropic(normalized);
  }
  if (provider === 'vertex') {
    return validateVertexApiKey(normalized);
  }
  if (provider === 'voyage') {
    return validateVoyage(normalized);
  }
  if (provider === 'cohere') {
    return validateCohere(normalized);
  }
  if (provider === 'aizolo') {
    return validateAizolo(normalized);
  }
  return validateOpenAICompatible(provider, normalized);
}
