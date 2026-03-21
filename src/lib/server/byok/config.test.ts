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

  it('defaults to vertex + anthropic when BYOK_ENABLED_PROVIDERS is unset', () => {
    vi.unstubAllEnvs();
    expect(getEnabledByokProviders()).toEqual(['vertex', 'anthropic']);
    expect(getEnabledReasoningProviders()).toEqual(['vertex', 'anthropic']);
  });

  it('parses and de-duplicates BYOK_ENABLED_PROVIDERS entries', () => {
    vi.stubEnv('BYOK_ENABLED_PROVIDERS', ' openai,vertex,openai,invalid,anthropic ');
    expect(getEnabledByokProviders()).toEqual(['openai', 'vertex', 'anthropic']);
    expect(getEnabledReasoningProviders()).toEqual(['vertex', 'anthropic', 'openai']);
    expect(isByokProviderEnabled('openai')).toBe(true);
    expect(isReasoningProviderEnabled('openai')).toBe(true);
    expect(isByokProviderEnabled('voyage')).toBe(false);
    expect(isReasoningProviderEnabled('perplexity')).toBe(false);
  });

  it('treats cohere as a reasoning-capable BYOK provider when enabled', () => {
    vi.stubEnv('BYOK_ENABLED_PROVIDERS', 'cohere,vertex');
    expect(getEnabledByokProviders()).toEqual(['cohere', 'vertex']);
    expect(getEnabledReasoningProviders()).toEqual(['vertex', 'cohere']);
    expect(isReasoningProviderEnabled('cohere')).toBe(true);
    expect(isByokProviderEnabled('cohere')).toBe(true);
  });
});
