import { describe, expect, it } from 'vitest';
import { BYOK_PROVIDERS, parseByokProvider } from './types';

describe('BYOK provider registry', () => {
  it('includes phase 1c providers', () => {
    expect(BYOK_PROVIDERS).toContain('xai');
    expect(BYOK_PROVIDERS).toContain('groq');
    expect(BYOK_PROVIDERS).toContain('mistral');
    expect(BYOK_PROVIDERS).toContain('deepseek');
    expect(BYOK_PROVIDERS).toContain('together');
    expect(BYOK_PROVIDERS).toContain('openrouter');
    expect(BYOK_PROVIDERS).toContain('perplexity');
    expect(BYOK_PROVIDERS).toContain('voyage');
  });

  it('parses additional providers case-insensitively', () => {
    expect(parseByokProvider('XAI')).toBe('xai');
    expect(parseByokProvider('openrouter')).toBe('openrouter');
    expect(parseByokProvider('voyage')).toBe('voyage');
    expect(parseByokProvider('unknown')).toBeNull();
  });
});
