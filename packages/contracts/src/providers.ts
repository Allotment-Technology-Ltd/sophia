import { z } from 'zod';

export const BYOK_PROVIDER_ORDER = [
  'vertex',
  'anthropic',
  'openai',
  'xai',
  'groq',
  'mistral',
  'deepseek',
  'together',
  'openrouter',
  'perplexity',
  'cohere',
  'voyage'
] as const;

export const ByokProviderSchema = z.enum(BYOK_PROVIDER_ORDER);

export type ByokProvider = z.infer<typeof ByokProviderSchema>;

export const REASONING_PROVIDER_ORDER = [
  'vertex',
  'anthropic',
  'openai',
  'xai',
  'groq',
  'mistral',
  'deepseek',
  'together',
  'cohere',
  'openrouter',
  'perplexity'
] as const;

export const ReasoningProviderSchema = z.enum(REASONING_PROVIDER_ORDER);

export type ReasoningProvider = z.infer<typeof ReasoningProviderSchema>;

export const ModelProviderSchema = z.union([z.literal('auto'), ReasoningProviderSchema]);

export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export interface ProviderUiMeta {
  label: string;
  modelLabel: string;
  hint: string;
  placeholder: string;
}

export const PROVIDER_UI_META: Record<ByokProvider, ProviderUiMeta> = {
  vertex: {
    label: 'Google Vertex / Gemini',
    modelLabel: 'Gemini',
    hint: 'Use a Google AI Studio / Gemini API key. Stored encrypted per account.',
    placeholder: 'AIza...'
  },
  anthropic: {
    label: 'Anthropic Claude',
    modelLabel: 'Claude',
    hint: 'Use an Anthropic API key. Stored encrypted per account.',
    placeholder: 'sk-ant-...'
  },
  openai: {
    label: 'OpenAI',
    modelLabel: 'OpenAI',
    hint: 'Use an OpenAI API key. Stored encrypted per account.',
    placeholder: 'sk-proj-...'
  },
  xai: {
    label: 'xAI / Grok',
    modelLabel: 'Grok',
    hint: 'Use an xAI API key for Grok models. Stored encrypted per account.',
    placeholder: 'xai-...'
  },
  groq: {
    label: 'Groq',
    modelLabel: 'Groq',
    hint: 'Use a Groq API key for high-speed open models. Stored encrypted per account.',
    placeholder: 'gsk_...'
  },
  mistral: {
    label: 'Mistral',
    modelLabel: 'Mistral',
    hint: 'Use a Mistral API key. Stored encrypted per account.',
    placeholder: 'mistral-...'
  },
  deepseek: {
    label: 'DeepSeek',
    modelLabel: 'DeepSeek',
    hint: 'Use a DeepSeek API key. Stored encrypted per account.',
    placeholder: 'sk-...'
  },
  together: {
    label: 'Together AI',
    modelLabel: 'Together',
    hint: 'Use a Together API key. Stored encrypted per account.',
    placeholder: 'together-...'
  },
  openrouter: {
    label: 'OpenRouter',
    modelLabel: 'OpenRouter',
    hint: 'Use an OpenRouter API key. Stored encrypted per account.',
    placeholder: 'sk-or-v1-...'
  },
  perplexity: {
    label: 'Perplexity',
    modelLabel: 'Perplexity',
    hint: 'Use a Perplexity API key. Stored encrypted per account.',
    placeholder: 'pplx-...'
  },
  cohere: {
    label: 'Cohere',
    modelLabel: 'Cohere',
    hint: 'Use a Cohere production or trial API key. Chat uses the OpenAI-compatible endpoint. Stored encrypted per account.',
    placeholder: '…'
  },
  voyage: {
    label: 'Voyage AI',
    modelLabel: 'Voyage',
    hint: 'Use a Voyage API key for embedding workloads. Stored encrypted per account.',
    placeholder: 'pa-...'
  }
};

export const DEFAULT_MODEL_CATALOG: Record<ReasoningProvider, string[]> = {
  vertex: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'text-embedding-005',
    'text-embedding-004',
    'multimodalembedding@001'
  ],
  anthropic: [
    'claude-opus-4-1-20250805',
    'claude-opus-4-20250514',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-5-20250514',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-haiku-4-5-20251001',
    'claude-3-5-haiku-20241022'
  ],
  openai: [
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'o3',
    'o3-mini',
    'o4-mini'
  ],
  xai: ['grok-3-beta', 'grok-3-mini-beta', 'grok-2-latest'],
  groq: [
    'llama-3.3-70b-versatile',
    'deepseek-r1-distill-llama-70b',
    'qwen-qwq-32b-preview',
    'mixtral-8x7b-32768',
    'gemma2-9b-it'
  ],
  mistral: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
    'ministral-8b-latest',
    'codestral-latest'
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
  together: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'Qwen/Qwen2.5-72B-Instruct-Turbo',
    'deepseek-ai/DeepSeek-R1',
    'deepseek-ai/DeepSeek-V3',
    'mistralai/Mixtral-8x22B-Instruct-v0.1'
  ],
  openrouter: [
    'anthropic/claude-sonnet-4',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.5-haiku',
    'openai/gpt-4.1',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-pro',
    'google/gemini-2.5-flash',
    'deepseek/deepseek-chat',
    'deepseek/deepseek-r1',
    'meta-llama/llama-3.3-70b-instruct',
    'qwen/qwen-2.5-72b-instruct'
  ],
  /** Aligned with @restormel/keys COHERE_MODELS plus common dated ids from operator catalogs. */
  cohere: [
    'command-r-plus',
    'command-r',
    'command-r7b',
    'command-r7b-12-2024',
    'command-light',
    'command-a',
    'aya-23-8b',
    'aya-23-35b'
  ],
  perplexity: ['sonar-reasoning-pro', 'sonar-reasoning', 'sonar-pro', 'sonar']
};

/** Voyage is BYOK-only (embeddings); exposed for UI / validation helpers. */
export const VOYAGE_EMBEDDING_MODEL_CATALOG: string[] = [
  'voyage-4-large',
  'voyage-4',
  'voyage-4-lite',
  'voyage-4-nano',
  'voyage-3-large',
  'voyage-3',
  'voyage-3-lite',
  'voyage-code-3',
  'voyage-finance-2',
  'voyage-law-2',
  'voyage-context-3',
  'voyage-multilingual-2',
  'voyage-2'
];

export const REASONING_PROVIDER_PLATFORM_API_KEY_ENV: Partial<Record<ReasoningProvider, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  together: 'TOGETHER_API_KEY',
  cohere: 'COHERE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY'
};

export const REASONING_PROVIDER_BASE_URL_ENV: Partial<Record<ReasoningProvider, string>> = {
  openai: 'OPENAI_BASE_URL',
  xai: 'XAI_BASE_URL',
  groq: 'GROQ_BASE_URL',
  mistral: 'MISTRAL_BASE_URL',
  deepseek: 'DEEPSEEK_BASE_URL',
  together: 'TOGETHER_BASE_URL',
  cohere: 'COHERE_BASE_URL',
  openrouter: 'OPENROUTER_BASE_URL',
  perplexity: 'PERPLEXITY_BASE_URL'
};

export const REASONING_PROVIDER_DEFAULT_BASE_URL: Partial<Record<ReasoningProvider, string>> = {
  xai: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  together: 'https://api.together.xyz/v1',
  /** Cohere OpenAI SDK compatibility layer (chat completions). */
  cohere: 'https://api.cohere.com/compatibility/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  perplexity: 'https://api.perplexity.ai'
};

const BYOK_PROVIDER_SET = new Set<string>(BYOK_PROVIDER_ORDER);
const REASONING_PROVIDER_SET = new Set<string>(REASONING_PROVIDER_ORDER);

export function isByokProvider(value: string | null | undefined): value is ByokProvider {
  if (!value) return false;
  return BYOK_PROVIDER_SET.has(value.trim().toLowerCase());
}

export function parseByokProvider(value: string | null | undefined): ByokProvider | undefined {
  if (!isByokProvider(value)) return undefined;
  return value.trim().toLowerCase() as ByokProvider;
}

export function isReasoningProvider(value: string | null | undefined): value is ReasoningProvider {
  if (!value) return false;
  return REASONING_PROVIDER_SET.has(value.trim().toLowerCase());
}

export function parseReasoningProvider(value: string | null | undefined): ReasoningProvider | undefined {
  if (!isReasoningProvider(value)) return undefined;
  return value.trim().toLowerCase() as ReasoningProvider;
}

export function getModelProviderLabel(provider: ReasoningProvider): string {
  return PROVIDER_UI_META[provider].modelLabel;
}
