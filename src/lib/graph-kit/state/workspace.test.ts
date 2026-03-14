import { describe, expect, it } from 'vitest';
import { reconcileKindSelection } from './workspace';

describe('reconcileKindSelection', () => {
  it('preserves the existing set instance when availability is unchanged', () => {
    const current = new Set(['claim', 'source']);
    const available = new Set(['claim', 'source']);

    const reconciled = reconcileKindSelection(current, available);

    expect(reconciled).toBe(current);
  });

  it('falls back to the available set when the current selection is empty', () => {
    const current = new Set<string>();
    const available = new Set(['claim', 'source']);

    const reconciled = reconcileKindSelection(current, available);

    expect([...reconciled]).toEqual(['claim', 'source']);
  });

  it('drops selections that no longer exist while keeping remaining kinds', () => {
    const current = new Set(['claim', 'source']);
    const available = new Set(['claim', 'evidence']);

    const reconciled = reconcileKindSelection(current, available);

    expect([...reconciled]).toEqual(['claim']);
  });
});
