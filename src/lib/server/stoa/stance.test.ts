import { describe, expect, it } from 'vitest';
import { detectStance } from './stance';

describe('detectStance', () => {
  it('selects sit_with for grief language', () => {
    const result = detectStance({
      message: 'My father died and I am grieving hard right now.',
      history: []
    });
    expect(result.stance).toBe('sit_with');
  });

  it('selects guide for practical planning prompts', () => {
    const result = detectStance({
      message: 'What should I do tomorrow before this difficult conversation?',
      history: []
    });
    expect(result.stance).toBe('guide');
  });

  it('falls back to previous agent stance when uncertain', () => {
    const result = detectStance({
      message: 'I am not sure.',
      history: [
        {
          role: 'agent',
          content: 'Let us begin with a practical next step.',
          timestamp: new Date().toISOString(),
          stance: 'guide'
        }
      ]
    });
    expect(result.stance).toBe('guide');
    expect(result.askClarifyingQuestion).toBe(true);
  });
});

