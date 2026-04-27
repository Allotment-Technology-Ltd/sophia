import { describe, expect, it } from 'vitest';
import { normalizeAizoloModelIdForApi } from './aizoloModelIds';

describe('normalizeAizoloModelIdForApi', () => {
  it('maps Restormel AiZolo Gemini carrier ids to AiZolo provider/model ids', () => {
    expect(normalizeAizoloModelIdForApi('aizolo-gemini-gemini-3-flash-preview')).toBe(
      'gemini/gemini-3-flash-preview'
    );
    expect(normalizeAizoloModelIdForApi('aizolo-gemini-gemini-3.1-pro-preview')).toBe(
      'gemini/gemini-3.1-pro-preview'
    );
  });

  it('maps other known AiZolo carrier ids', () => {
    expect(normalizeAizoloModelIdForApi('aizolo-deepseek-deepseek-chat')).toBe(
      'deepseek/deepseek-chat'
    );
    expect(normalizeAizoloModelIdForApi('aizolo-mistral')).toBe('mistral');
  });

  it('leaves already-normalized or unknown ids unchanged', () => {
    expect(normalizeAizoloModelIdForApi('gemini/gemini-3-flash-preview')).toBe(
      'gemini/gemini-3-flash-preview'
    );
    expect(normalizeAizoloModelIdForApi('custom-model')).toBe('custom-model');
  });
});
