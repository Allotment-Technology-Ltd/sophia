import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getEnabledByokProviders,
  getEnabledReasoningProviders,
  isByokProviderEnabled,
  isReasoningProviderEnabled
} from './config';

describe('byok rollout config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enables all BYOK providers from contracts by default', () => {
    vi.unstubAllEnvs();
    expect(getEnabledByokProviders()).toEqual([
      'vertex',
      'anthropic',
      'openai',
      'groq',
      'mistral',
      'deepseek',
      'together',
      'openrouter',
      'perplexity',
      'cohere',
      'voyage'
    ]);
    expect(getEnabledReasoningProviders()).toEqual([
      'vertex',
      'anthropic',
      'openai',
      'groq',
      'mistral',
      'deepseek',
      'together',
      'cohere',
      'openrouter',
      'perplexity'
    ]);
  });

  it('ignores BYOK_ENABLED_PROVIDERS allowlists and keeps all providers enabled', () => {
    vi.stubEnv('BYOK_ENABLED_PROVIDERS', ' openai,vertex,openai,invalid,anthropic ');
    expect(getEnabledByokProviders()).toEqual([
      'vertex',
      'anthropic',
      'openai',
      'groq',
      'mistral',
      'deepseek',
      'together',
      'openrouter',
      'perplexity',
      'cohere',
      'voyage'
    ]);
    expect(getEnabledReasoningProviders()).toEqual([
      'vertex',
      'anthropic',
      'openai',
      'groq',
      'mistral',
      'deepseek',
      'together',
      'cohere',
      'openrouter',
      'perplexity'
    ]);
    expect(isByokProviderEnabled('openai')).toBe(true);
    expect(isReasoningProviderEnabled('openai')).toBe(true);
    expect(isByokProviderEnabled('cohere' as any)).toBe(true);
    expect(isReasoningProviderEnabled('cohere' as any)).toBe(true);
    expect(isByokProviderEnabled('voyage')).toBe(true);
    expect(isReasoningProviderEnabled('perplexity')).toBe(true);
  });
});
