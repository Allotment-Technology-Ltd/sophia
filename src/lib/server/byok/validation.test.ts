import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateProviderApiKey } from './validation';

describe('validateProviderApiKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('validates OpenAI keys via the models endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateProviderApiKey('openai', 'sk-test-openai');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer sk-test-openai'
        }
      })
    );
  });

  it('returns a provider-specific OpenAI validation error when rejected', async () => {
    const fetchMock = vi.fn(async () => new Response('invalid key', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateProviderApiKey('openai', 'sk-invalid');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('openai_validation_failed_401:invalid key');
  });

  it('rejects empty keys before any provider call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateProviderApiKey('openai', '   ');

    expect(result).toEqual({ ok: false, error: 'empty_api_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
