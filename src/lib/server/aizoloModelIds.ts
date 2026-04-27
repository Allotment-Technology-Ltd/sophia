/**
 * Restormel Keys catalog rows often expose AiZolo carrier ids such as
 * `aizolo-gemini-gemini-3-flash-preview`. AiZolo's OpenAI-compatible API expects
 * `provider/model-id` (for example `gemini/gemini-3-flash-preview`).
 */
export function normalizeAizoloModelIdForApi(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes('/')) return trimmed;
  if (!trimmed.startsWith('aizolo-')) return trimmed;

  const rest = trimmed.slice('aizolo-'.length);
  const knownProviders = [
    'perplexity',
    'microsoft',
    'deepseek',
    'longcat',
    'mistral',
    'hunyuan',
    'gemini',
    'claude',
    'openai',
    'nvidia',
    'grok',
    'meta',
    'qwen',
    'kimi',
    'mimo',
    'zai'
  ];

  for (const provider of knownProviders) {
    if (rest === provider) return provider;
    const prefix = `${provider}-`;
    if (rest.startsWith(prefix)) {
      return `${provider}/${rest.slice(prefix.length)}`;
    }
  }

  return trimmed;
}
