import { describe, expect, it } from 'vitest';
import { ensureHarvardReferencesSection } from './harvard';

describe('ensureHarvardReferencesSection', () => {
  it('appends a Harvard references section when missing', () => {
    const input = '## Abstract\n\nA short synthesis with attribution to Kant (Kant, 1785).';
    const result = ensureHarvardReferencesSection(input, 'synthesis');

    expect(result.appended).toBe(true);
    expect(result.text).toContain('## References (Harvard)');
    expect(result.appendedText).toContain('Harvard format required');
  });

  it('is idempotent when Harvard references section already exists', () => {
    const input =
      '## Summary\n\nClaim text.\n\n## References (Harvard)\n- Kant, I. (1785) *Groundwork*.';
    const first = ensureHarvardReferencesSection(input, 'verification');
    const second = ensureHarvardReferencesSection(first.text, 'verification');

    expect(first.appended).toBe(false);
    expect(second.appended).toBe(false);
    expect(second.text.match(/## References \(Harvard\)/g)?.length ?? 0).toBe(1);
  });
});

