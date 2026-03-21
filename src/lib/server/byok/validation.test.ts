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

  it('validates Voyage keys via embeddings probe endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateProviderApiKey('voyage', 'pa-valid-voyage-key');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer pa-valid-voyage-key',
          'Content-Type': 'application/json'
        })
      })
    );
    const init = (fetchMock as any).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init).toBeDefined();
    expect(JSON.parse(String(init?.body ?? '{}'))).toEqual({
      input: 'BYOK validation probe',
      model: 'voyage-3.5',
      input_type: 'document'
    });
  });

  it('returns voyage-specific validation errors', async () => {
    const fetchMock = vi.fn(async () => new Response('{"detail":"Not Found"}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateProviderApiKey('voyage', 'pa-invalid');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('voyage_validation_failed_404:{"detail":"Not Found"}');
  });
});
