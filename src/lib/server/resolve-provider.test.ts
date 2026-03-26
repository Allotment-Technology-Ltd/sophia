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
        endpoint: '/projects/project-id/resolve',
        payload: { error: 'policy_blocked' },
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
        endpoint: '/projects/project-id/resolve',
        payload: { error: 'policy_blocked' },
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

  it('classifies resolve_incomplete (422) as unknown with operator userMessage', () => {
    const failure = classifyResolveFailure(
      new RestormelResolveError({
        status: 422,
        code: 'resolve_incomplete',
        detail: 'Step not executable',
        endpoint: '/projects/p/resolve',
        payload: { error: 'resolve_incomplete', userMessage: 'Fix model on step 0.' },
        userMessage: 'Fix model on step 0.',
        violations: []
      })
    );
    expect(failure.kind).toBe('unknown');
    expect(failure.userMessage).toBe('Fix model on step 0.');
    expect(failure.logContext).toMatchObject({ code: 'resolve_incomplete', status: 422 });
  });

  it('classifies route_disabled by JSON error (not generic 403 auth)', () => {
    const failure = classifyResolveFailure(
      new RestormelResolveError({
        status: 403,
        code: 'route_disabled',
        detail: 'Route disabled',
        endpoint: '/projects/p/resolve',
        payload: { error: 'route_disabled' },
        userMessage: 'The matching route is disabled in Restormel Keys. Enable it or pick another route.',
        violations: []
      })
    );
    expect(failure.kind).toBe('unknown');
    expect(failure.logContext).toMatchObject({ code: 'route_disabled', status: 403 });
  });
});

describe('resolveProviderDecision', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps Restormel google / vertex_ai providerType aliases to vertex', async () => {
    const restormel = await import('./restormel');
    const { resolveProviderDecision } = await import('./resolve-provider');
    vi.spyOn(restormel, 'restormelResolve').mockResolvedValue({
      data: {
        contractVersion: '2026-03-26',
        routeId: 'r1',
        providerType: 'google',
        modelId: 'gemini-2.5-flash',
        explanation: 'ok',
        stepChain: [
          {
            stepId: 's0',
            orderIndex: 0,
            providerType: 'vertex',
            modelId: 'gemini-2.5-flash',
            enabled: true,
            selected: true
          }
        ]
      }
    });

    const result = await resolveProviderDecision({
      routeId: 'r1',
      safeDefault: { provider: 'vertex', model: 'gemini-2.5-flash' }
    });

    expect(result.provider).toBe('vertex');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.stepChain?.[0]?.providerType).toBe('vertex');
  });

  it('logs policy-blocked resolves as warnings and returns the degraded default', async () => {
    const restormel = await import('./restormel');
    const { resolveProviderDecision } = await import('./resolve-provider');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new restormel.RestormelResolveError({
      status: 403,
      code: 'policy_blocked',
      detail: 'All route steps were blocked by policy',
      endpoint: '/projects/project-id/resolve',
      payload: { error: 'policy_blocked' },
      userMessage: 'No permitted AI model route is currently available.',
      violations: [
        {
          type: 'model_allowlist',
          message: 'Model gpt-4o is not in allowlist'
        }
      ]
    });
    vi.spyOn(restormel, 'restormelResolve').mockRejectedValue(error);

    const result = await resolveProviderDecision({
      routeId: 'interactive',
      safeDefault: {
        provider: 'vertex',
        model: 'gemini-2.5-flash'
      }
    });

    expect(result).toEqual({
      provider: 'vertex',
      model: 'gemini-2.5-flash',
      source: 'degraded_default',
      routeId: null,
      explanation: 'No permitted AI model route is currently available. Using Sophia\'s degraded default route.',
      failureKind: 'policy_blocked',
      selectedStepId: null,
      selectedOrderIndex: null,
      switchReasonCode: null,
      estimatedCostUsd: null,
      matchedCriteria: null,
      fallbackCandidates: null,
      stepChain: null
    });
    expect(warn).toHaveBeenCalledWith(
      '[restormel] Policy blocked all Restormel route steps; evaluating degraded fallback',
      expect.objectContaining({
        code: 'policy_blocked',
        status: 403,
        policyTypes: ['model_allowlist']
      })
    );
  });

  it('retries without stage when stage-specific resolve returns no_route', async () => {
    const restormel = await import('./restormel');
    const { resolveProviderDecision } = await import('./resolve-provider');
    const noRoute = new restormel.RestormelResolveError({
      status: 404,
      code: 'no_route',
      detail: 'No route found for this stage',
      endpoint: '/projects/project-id/resolve',
      payload: { error: 'no_route' },
      userMessage: 'No route found for this stage.',
      violations: []
    });
    const resolveSpy = vi.spyOn(restormel, 'restormelResolve');
    resolveSpy
      .mockRejectedValueOnce(noRoute)
      .mockResolvedValueOnce({
        data: {
          contractVersion: '2026-03-26',
          routeId: 'fallback-shared-route',
          providerType: 'google',
          modelId: 'gemini-2.5-flash',
          explanation: 'Matched shared ingestion route',
          stepChain: null
        }
      });

    const result = await resolveProviderDecision({
      restormelContext: {
        workload: 'ingestion',
        stage: 'relations'
      },
      safeDefault: { provider: 'vertex', model: 'gemini-2.5-flash' }
    });

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(resolveSpy.mock.calls[0]?.[0]).toMatchObject({
      workload: 'ingestion',
      stage: 'relations'
    });
    expect(resolveSpy.mock.calls[1]?.[0]).toMatchObject({
      workload: 'ingestion'
    });
    expect(resolveSpy.mock.calls[1]?.[0]).not.toHaveProperty('stage');
    expect(result.source).toBe('restormel');
    expect(result.provider).toBe('vertex');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.routeId).toBe('fallback-shared-route');
  });
});
