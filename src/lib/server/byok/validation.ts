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
  return validateBearerModelsEndpoint('voyage', apiKey, 'https://api.voyageai.com/v1/models');
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
  return validateOpenAICompatible(provider, normalized);
}
