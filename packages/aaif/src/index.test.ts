import { describe, expect, it } from 'vitest';
import {
  AAIFRequestSchema,
  AAIFResponseSchema,
  isAAIFRequest,
  isAAIFResponse
} from './index';

describe('@restormel/aaif compatibility package', () => {
  it('accepts valid AAIF requests', () => {
    const request = {
      input: 'Summarise this argument.',
      task: 'completion',
      constraints: {
        maxCost: 0.02,
        latency: 'balanced'
      },
      user: {
        id: 'user_123',
        plan: 'pro'
      }
    };

    expect(isAAIFRequest(request)).toBe(true);
    expect(AAIFRequestSchema.parse(request)).toEqual(request);
  });

  it('accepts valid AAIF responses', () => {
    const response = {
      output: 'Summary',
      provider: 'vertex',
      model: 'gemini-2.5-flash',
      cost: 0.0012,
      routing: {
        reason: 'Restormel route selected the lowest-latency permitted model.'
      }
    };

    expect(isAAIFResponse(response)).toBe(true);
    expect(AAIFResponseSchema.parse(response)).toEqual(response);
  });
});
