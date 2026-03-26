import { describe, expect, it } from 'vitest';
import { isExcludedXaiGrokCatalogRef } from './modelCatalogEthics';

describe('modelCatalogEthics', () => {
  it('excludes xAI provider and Grok model ids', () => {
    expect(isExcludedXaiGrokCatalogRef('xai', 'anything')).toBe(true);
    expect(isExcludedXaiGrokCatalogRef('x.ai', 'anything')).toBe(true);
    expect(isExcludedXaiGrokCatalogRef('openai', 'grok-3')).toBe(true);
    expect(isExcludedXaiGrokCatalogRef('openrouter', 'x-ai/grok-2')).toBe(true);
    expect(isExcludedXaiGrokCatalogRef('openrouter', 'vendor/grok-beta')).toBe(true);
  });

  it('does not exclude Groq or unrelated models', () => {
    expect(isExcludedXaiGrokCatalogRef('groq', 'llama-3.3-70b-versatile')).toBe(false);
    expect(isExcludedXaiGrokCatalogRef('openai', 'gpt-4o')).toBe(false);
  });
});
