import { describe, expect, it } from 'vitest';
import { normalizeIngestPinModelId } from './ingestPinNormalize';

describe('normalizeIngestPinModelId', () => {
  it('maps anthropic haiku alias to dated id', () => {
    expect(normalizeIngestPinModelId('anthropic', 'claude-3-5-haiku')).toBe(
      'claude-3-5-haiku-20241022'
    );
  });

  it('leaves dated haiku unchanged', () => {
    expect(normalizeIngestPinModelId('anthropic', 'claude-3-5-haiku-20241022')).toBe(
      'claude-3-5-haiku-20241022'
    );
  });

  it('maps retired Gemini 1.5 ids', () => {
    expect(normalizeIngestPinModelId('vertex', 'gemini-1.5-pro')).toBe('gemini-2.5-pro');
    expect(normalizeIngestPinModelId('google', 'gemini-1.5-flash')).toBe('gemini-2.5-flash');
  });
});
