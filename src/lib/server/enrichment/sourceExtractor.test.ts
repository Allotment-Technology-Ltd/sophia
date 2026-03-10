import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractFromSource } from './sourceExtractor';

const DEFAULT_BUDGET = { maxBytes: 256_000, maxLatencyMs: 2_000 };

describe('extractFromSource security hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips script/style/active HTML content before extracting text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        `<html><body><h1>Title</h1><script>alert(1)</script><style>body{display:none}</style><p>Body text</p></body></html>`,
        {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        }
      )
    );

    const result = await extractFromSource({
      url: 'https://example.com/page',
      mimeType: 'text/html',
      budget: DEFAULT_BUDGET
    });

    expect(result.text).toContain('Title');
    expect(result.text).toContain('Body text');
    expect(result.text).not.toContain('alert(1)');
    expect(result.text).not.toContain('display:none');
  });

  it('blocks local/private hosts before making any network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await extractFromSource({
      url: 'http://localhost/admin',
      mimeType: 'text/html',
      budget: DEFAULT_BUDGET
    });

    expect(result.text).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks redirects to private hosts', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/secret' }
        })
      );

    const result = await extractFromSource({
      url: 'https://example.com/redirect',
      mimeType: 'text/html',
      budget: DEFAULT_BUDGET
    });

    expect(result.text).toBe('');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects script-like content types', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('alert("owned")', {
        status: 200,
        headers: { 'content-type': 'application/javascript' }
      })
    );

    const result = await extractFromSource({
      url: 'https://example.com/payload.js',
      mimeType: 'text/html',
      budget: DEFAULT_BUDGET
    });

    expect(result.text).toBe('');
    expect(result.metadata.bytes).toBe(0);
  });
});
