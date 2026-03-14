import { describe, expect, it } from 'vitest';
import { formatTraceTag, getNodeTraceLabel, getNodeTraceTags } from './graphTrace';
import type { GraphNode } from '@restormel/contracts/api';

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'claim:1',
    type: 'claim',
    label: 'Test claim',
    ...overrides
  };
}

describe('graphTrace', () => {
  it('builds tags in stable order', () => {
    const tags = getNodeTraceTags(makeNode({
      isSeed: true,
      pass_origin: 'analysis',
      conflict_status: 'contested',
      unresolved_tension_id: 'tension-1',
      provenance_id: 'prov-1'
    }));

    expect(tags).toEqual(['seed', 'analysis', 'contested', 'tension', 'provenanced']);
  });

  it('limits rendered trace label and formats tags', () => {
    const node = makeNode({
      isTraversed: true,
      pass_origin: 'critique',
      conflict_status: 'unresolved',
      unresolved_tension_id: 'tension-2',
      provenance_id: 'prov-2'
    });

    expect(getNodeTraceLabel(node, 3)).toBe('traversed · critique · unresolved');
    expect(formatTraceTag('philosophy_of_mind')).toBe('philosophy of mind');
  });
});
