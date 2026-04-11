import { describe, expect, it } from 'vitest';
import {
  createSophiaModelSelectorKeys,
  createSophiaModelSelectorProviders,
  toRestormelSelectorProviderId,
  toSophiaSelectorProviderId
} from './model-selector';

describe('restormel model selector helpers', () => {
  it('maps Sophia provider ids to Restormel canonical ids and back', () => {
    expect(toRestormelSelectorProviderId('vertex')).toBe('google');
    expect(toSophiaSelectorProviderId('google')).toBe('vertex');
    expect(toSophiaSelectorProviderId('anthropic')).toBe('anthropic');
  });

  it('builds provider definitions from the visible model options', () => {
    const providers = createSophiaModelSelectorProviders([
      { provider: 'vertex', id: 'gemini-3-flash-preview' },
      { provider: 'vertex', id: 'gemini-3.1-pro-preview' },
      { provider: 'anthropic', id: 'claude-3-5-sonnet' }
    ]);

    expect(providers.map((provider) => provider.id)).toEqual(['anthropic', 'google']);
    expect(providers.find((provider) => provider.id === 'google')?.models).toEqual([
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview'
    ]);
  });

  it('models platform availability for the packaged selector without exposing secrets', async () => {
    const providers = createSophiaModelSelectorProviders([
      { provider: 'vertex', id: 'gemini-3-flash-preview' }
    ]);

    const keys = createSophiaModelSelectorKeys([], providers, 'platform');

    await expect(keys.resolve('google', 'gemini-3-flash-preview')).resolves.toMatchObject({
      provider: 'google',
      model: 'gemini-3-flash-preview',
      source: 'platform'
    });
  });
});
