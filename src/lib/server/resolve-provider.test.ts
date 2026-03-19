import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestormelResolveError } from './restormel';
import { classifyResolveFailure } from './resolve-provider';

describe('classifyResolveFailure', () => {
  it('classifies budget and token cap policy violations as budget_cap', () => {
    const failure = classifyResolveFailure(
      new RestormelResolveError({
        status: 403,
        code: 'policy_blocked',
        detail: 'All route steps were blocked by policy',
        userMessage: 'AI model routing is temporarily unavailable because workspace usage limits were reached.',
        violations: [
          {
            type: 'budget_cap',
            message: 'Budget cap exceeded: 0.10 >= 0.01 (limit)'
          }
        ]
      })
    );

    expect(failure.kind).toBe('budget_cap');
    expect(failure.logContext).toMatchObject({
      code: 'policy_blocked',
      status: 403,
      policyTypes: ['budget_cap']
    });
  });

  it('classifies non-cap policy violations as policy_blocked', () => {
    const failure = classifyResolveFailure(
      new RestormelResolveError({
        status: 403,
        code: 'policy_blocked',
        detail: 'All route steps were blocked by policy',
        userMessage: 'No permitted AI model route is currently available.',
        violations: [
          {
            type: 'model_allowlist',
            message: 'Model gpt-4o is not in allowlist'
          }
        ]
      })
    );

    expect(failure.kind).toBe('policy_blocked');
    expect(failure.logContext).toMatchObject({
      code: 'policy_blocked',
      status: 403,
      policyTypes: ['model_allowlist']
    });
  });
});

describe('resolveProviderDecision', () => {
  const originalUseRestormelKeys = process.env.USE_RESTORMEL_KEYS;

  beforeEach(() => {
    vi.resetModules();
    process.env.USE_RESTORMEL_KEYS = 'true';
  });

  afterEach(() => {
    if (originalUseRestormelKeys === undefined) {
      delete process.env.USE_RESTORMEL_KEYS;
    } else {
      process.env.USE_RESTORMEL_KEYS = originalUseRestormelKeys;
    }
    vi.restoreAllMocks();
  });

  it('logs policy-blocked resolves as warnings and preserves legacy fallback', async () => {
    const restormel = await import('./restormel');
    const { resolveProviderDecision } = await import('./resolve-provider');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new restormel.RestormelResolveError({
      status: 403,
      code: 'policy_blocked',
      detail: 'All route steps were blocked by policy',
      userMessage: 'No permitted AI model route is currently available.',
      violations: [
        {
          type: 'model_allowlist',
          message: 'Model gpt-4o is not in allowlist'
        }
      ]
    });
    vi.spyOn(restormel, 'restormelResolve').mockRejectedValue(error);

    const legacy = vi.fn(() => ({
      provider: 'vertex' as const,
      model: 'gemini-2.5-flash',
      source: 'legacy' as const
    }));

    const result = await resolveProviderDecision({
      legacy,
      routeId: 'interactive'
    });

    expect(result).toEqual({
      provider: 'vertex',
      model: 'gemini-2.5-flash',
      source: 'legacy'
    });
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[restormel] Policy blocked all Restormel route steps; using legacy fallback',
      expect.objectContaining({
        code: 'policy_blocked',
        status: 403,
        policyTypes: ['model_allowlist']
      })
    );
  });
});
