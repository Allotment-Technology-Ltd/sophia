import { describe, expect, it } from 'vitest';
import { buildCrisisSupportMessage, detectCrisisRisk, detectSuppressionMisuse } from './safety';

describe('safety helpers', () => {
  it('detects high-risk crisis language', () => {
    expect(detectCrisisRisk('I want to end my life tonight')).toBe(true);
  });

  it('does not flag neutral language as crisis', () => {
    expect(detectCrisisRisk('I had a hard day at work')).toBe(false);
  });

  it('detects emotion suppression misuse framing', () => {
    expect(detectSuppressionMisuse('Stoicism means I should ignore my feelings')).toBe(true);
  });

  it('includes immediate support actions in crisis message', () => {
    const message = buildCrisisSupportMessage();
    expect(message).toContain('988');
    expect(message).toContain('Samaritans 116 123');
  });
});

