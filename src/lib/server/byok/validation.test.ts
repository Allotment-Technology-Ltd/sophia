import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeAizoloModelWithApiKey, validateProviderApiKey } from './validation';

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

  it('validates AiZolo keys via POST /chat/completions (not GET /models)', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateProviderApiKey('aizolo', 'aizolo_test_key');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chat.aizolo.com/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer aizolo_test_key',
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('treats AiZolo 429 as valid (rate limit implies accepted key)', async () => {
    const fetchMock = vi.fn(async () => new Response('too many', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateProviderApiKey('aizolo', 'aizolo_test_key');

    expect(result).toEqual({ ok: true });
  });

  it('accepts AiZolo base url set to the full /chat/completions endpoint', async () => {
    process.env.AIZOLO_BASE_URL = 'https://chat.aizolo.com/api/v1/chat/completions';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateProviderApiKey('aizolo', 'aizolo_test_key');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chat.aizolo.com/api/v1/chat/completions',
      expect.any(Object)
    );
    delete process.env.AIZOLO_BASE_URL;
  });

  it('probes an explicit AiZolo model id via the saved-key chat completions path', async () => {
    process.env.AIZOLO_BASE_URL = 'https://chat.aizolo.test/api/v1';
    const fetchMock = vi.fn(async () => new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeAizoloModelWithApiKey(
      'aizolo_test_key',
      'aizolo-gemini-gemini-3-flash-preview'
    );

    expect(result).toMatchObject({
      ok: true,
      provider: 'aizolo',
      modelId: 'aizolo-gemini-gemini-3-flash-preview',
      endpoint: 'https://chat.aizolo.test/api/v1/chat/completions',
      status: 200
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chat.aizolo.test/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer aizolo_test_key',
          'Content-Type': 'application/json'
        })
      })
    );
    const init = (fetchMock as any).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body ?? '{}'))).toMatchObject({
      model: 'aizolo-gemini-gemini-3-flash-preview',
      max_tokens: 2,
      temperature: 0
    });
    delete process.env.AIZOLO_BASE_URL;
  });

  it('returns AiZolo model probe failure details', async () => {
    const fetchMock = vi.fn(async () => new Response('unknown model', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeAizoloModelWithApiKey(
      'aizolo_test_key',
      'aizolo-gemini-missing-model'
    );

    expect(result).toMatchObject({
      ok: false,
      provider: 'aizolo',
      modelId: 'aizolo-gemini-missing-model',
      status: 404,
      error: 'aizolo_model_probe_failed_404:unknown model',
      responsePreview: 'unknown model'
    });
  });
});
