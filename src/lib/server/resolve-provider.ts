import { isReasoningProvider, type ModelProvider, type ReasoningProvider } from '@restormel/contracts/providers';
import {
  RESTORMEL_ENVIRONMENT_ID,
  RestormelResolveError,
  type ResolveRequest,
  type RestormelFallbackCandidate,
  type RestormelStepChainEntry,
  restormelResolve
} from './restormel';

export interface ProviderDecision {
  provider: ReasoningProvider;
  model: string | null;
  source: 'restormel' | 'requested' | 'degraded_default';
  routeId?: string | null;
  explanation?: string | null;
  failureKind?: ResolveFailureKind;
  selectedStepId?: string | null;
  selectedOrderIndex?: number | null;
  switchReasonCode?: string | null;
  estimatedCostUsd?: number | null;
  matchedCriteria?: unknown;
  fallbackCandidates?: RestormelFallbackCandidate[] | null;
  /** Full ordered step chain when Keys returns it (resolve/simulate contract 2026-03-26+). */
  stepChain?: RestormelStepChainEntry[] | null;
}

export type ResolveFailureKind =
  | 'budget_cap'
  | 'no_key_available'
  | 'policy_blocked'
  | 'network_or_auth'
  | 'unknown';

/** Logged when resolve falls back to Sophia defaults so operators can fix Keys config. */
function logRestormelIngestionDegradedHint(
  failure: { kind: ResolveFailureKind; logContext: Record<string, unknown> },
  restormelContext?: Omit<ResolveRequest, 'environmentId' | 'routeId'>
): void {
  if (restormelContext?.workload !== 'ingestion') return;
  const stage = restormelContext.stage?.trim();
  const stageLine = stage
    ? `Dedicated route: stage="${stage}". Or a shared ingestion route with empty stage.`
    : 'Use workload=ingestion and stage=ingestion_<substage> (e.g. ingestion_extraction) or a shared route.';
  console.warn(
    '[restormel] Ingestion routing degraded — operator checklist: ' +
      `${stageLine} ` +
      'Publish routes (publishedVersion must match version). ' +
      'Verify RESTORMEL_PROJECT_ID, RESTORMEL_ENVIRONMENT_ID, RESTORMEL_GATEWAY_KEY (rk_…). ' +
      `Resolve detail: kind=${failure.kind} context=${JSON.stringify({
        ...failure.logContext,
        environmentId: RESTORMEL_ENVIRONMENT_ID,
        workload: restormelContext.workload,
        stage: restormelContext.stage
      })}. ` +
      'Sophia: src/lib/server/restormelIngestionRoutes.ts'
  );
}

export class ProviderResolutionFailure extends Error {
  readonly kind: ResolveFailureKind;
  readonly userMessage: string;
  readonly logContext: Record<string, unknown>;

  constructor(options: {
    kind: ResolveFailureKind;
    userMessage: string;
    logContext: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(options.userMessage);
    this.name = 'ProviderResolutionFailure';
    this.kind = options.kind;
    this.userMessage = options.userMessage;
    this.logContext = options.logContext;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function normalizeRestormelProvider(providerType: string | null): ReasoningProvider | null {
  const normalized = providerType?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'google' || normalized === 'vertex_ai') {
    return 'vertex';
  }
  return isReasoningProvider(normalized) ? normalized : null;
}

export function classifyResolveFailure(error: unknown): {
  kind: ResolveFailureKind;
  userMessage: string;
  logContext: Record<string, unknown>;
} {
  if (error instanceof RestormelResolveError) {
    const policyTypes = error.violations
      .map((violation) => violation.type?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
    const hasBudgetCap =
      policyTypes.includes('budget_cap') || policyTypes.includes('token_cap');
    if (error.code === 'policy_blocked' && hasBudgetCap) {
      return {
        kind: 'budget_cap',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status, policyTypes }
      };
    }
    if (error.code === 'no_key_available') {
      return {
        kind: 'no_key_available',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status }
      };
    }
    if (error.code === 'resolve_incomplete') {
      return {
        kind: 'unknown',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status }
      };
    }
    if (error.code === 'policy_blocked') {
      return {
        kind: 'policy_blocked',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status, policyTypes }
      };
    }
    // Restormel Keys control plane: branch on JSON `error`, not only HTTP status (403 can be route_disabled).
    if (
      error.code === 'no_route' ||
      error.code === 'route_unpublished' ||
      error.code === 'route_disabled'
    ) {
      return {
        kind: 'unknown',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status }
      };
    }
    if (error.code === 'unauthorized' || error.status === 401) {
      return {
        kind: 'network_or_auth',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status }
      };
    }
    if (error.status === 403) {
      return {
        kind: 'network_or_auth',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status }
      };
    }
    return {
      kind: 'unknown',
      userMessage: error.userMessage,
      logContext: { code: error.code, status: error.status }
    };
  }

  if (error instanceof Error) {
    return {
      kind: 'network_or_auth',
      userMessage: 'AI model routing is temporarily unavailable right now.',
      logContext: { errorName: error.name }
    };
  }

  return {
    kind: 'unknown',
    userMessage: 'AI model routing is temporarily unavailable right now.',
    logContext: {}
  };
}

export async function resolveProviderDecision(options: {
  preferredProvider?: ModelProvider;
  preferredModel?: string;
  routeId?: string;
  restormelContext?: Omit<ResolveRequest, 'environmentId' | 'routeId'>;
  safeDefault?: {
    provider: ReasoningProvider;
    model: string | null;
    explanation?: string | null;
  };
  failureMode?: 'degraded_default' | 'error';
}): Promise<ProviderDecision> {
  const decisionFromResolveResult = (
    result: Awaited<ReturnType<typeof restormelResolve>>['data']
  ): ProviderDecision => {
    const providerType = normalizeRestormelProvider(result.providerType);
    if (!providerType) {
      throw new ProviderResolutionFailure({
        kind: 'unknown',
        userMessage: 'AI model routing returned an unsupported provider.',
        logContext: { providerType: result.providerType }
      });
    }

    return {
      provider: providerType,
      model: result.modelId ?? options.preferredModel ?? null,
      source: 'restormel',
      routeId: result.routeId,
      explanation: result.explanation,
      selectedStepId: result.selectedStepId ?? null,
      selectedOrderIndex: result.selectedOrderIndex ?? null,
      switchReasonCode: result.switchReasonCode ?? null,
      estimatedCostUsd: result.estimatedCostUsd ?? null,
      matchedCriteria: result.matchedCriteria ?? null,
      fallbackCandidates: result.fallbackCandidates ?? null,
      stepChain: result.stepChain ?? null
    };
  };

  if (options.preferredProvider && options.preferredProvider !== 'auto') {
    return {
      provider: options.preferredProvider,
      model: options.preferredModel?.trim() || null,
      source: 'requested',
      routeId: options.routeId ?? null,
      explanation: options.preferredModel?.trim()
        ? `User selected ${options.preferredProvider}/${options.preferredModel.trim()}.`
        : `User selected ${options.preferredProvider}.`,
      stepChain: null
    };
  }

  try {
    let result = await restormelResolve({
      environmentId: RESTORMEL_ENVIRONMENT_ID,
      routeId: options.routeId,
      ...options.restormelContext
    });
    const stageName = options.restormelContext?.stage;
    const canRetryWithoutStage = !options.routeId && Boolean(stageName);
    if (!result?.data?.providerType && canRetryWithoutStage) {
      // Defensive guard for unexpected empty payloads; re-resolve on the shared workload route.
      const { stage: _stage, ...contextWithoutStage } = options.restormelContext ?? {};
      result = await restormelResolve({
        environmentId: RESTORMEL_ENVIRONMENT_ID,
        routeId: options.routeId,
        ...contextWithoutStage
      });
    }
    return decisionFromResolveResult(result.data);
  } catch (error) {
    if (
      error instanceof RestormelResolveError &&
      error.code === 'no_route' &&
      options.restormelContext
    ) {
      const retryRequests: ResolveRequest[] = [];
      if (options.routeId) {
        retryRequests.push({
          environmentId: RESTORMEL_ENVIRONMENT_ID,
          ...options.restormelContext
        });
      }
      if (options.restormelContext.stage) {
        const { stage: _stage, ...contextWithoutStage } = options.restormelContext;
        retryRequests.push({
          environmentId: RESTORMEL_ENVIRONMENT_ID,
          ...contextWithoutStage
        });
      }

      for (const retryRequest of retryRequests) {
        try {
          const retried = await restormelResolve(retryRequest);
          const decision = decisionFromResolveResult(retried.data);
          if (options.routeId) {
            console.warn('[restormel] RouteId resolve returned no_route; recovered via ingestion metadata route', {
              routeId: options.routeId,
              recoveredRouteId: decision.routeId,
              workload: retryRequest.workload,
              stage: retryRequest.stage ?? null
            });
          }
          return decision;
        } catch {
          // Preserve original no_route handling below unless a metadata/shared retry succeeds.
        }
      }
    }
    const failure =
      error instanceof ProviderResolutionFailure
        ? {
            kind: error.kind,
            userMessage: error.userMessage,
            logContext: error.logContext
          }
        : classifyResolveFailure(error);
    const logger = failure.kind === 'budget_cap' || failure.kind === 'unknown'
      ? console.error
      : console.warn;

    if (failure.kind === 'budget_cap') {
      logger('[restormel] Usage policy blocked model routing; evaluating degraded fallback', failure.logContext);
    } else if (failure.kind === 'no_key_available') {
      logger('[restormel] No provider key available for Restormel route; evaluating degraded fallback', failure.logContext);
    } else if (failure.kind === 'policy_blocked') {
      logger('[restormel] Policy blocked all Restormel route steps; evaluating degraded fallback', failure.logContext);
    } else {
      logger('[restormel] Resolve failed before a safe route was selected', failure.logContext);
    }

    if (options.failureMode !== 'error' && options.safeDefault) {
      logRestormelIngestionDegradedHint(failure, options.restormelContext);
      return {
        provider: options.safeDefault.provider,
        model: options.safeDefault.model,
        source: 'degraded_default',
        routeId: null,
        explanation:
          options.safeDefault.explanation ??
          `${failure.userMessage} Using Sophia's degraded default route.`,
        failureKind: failure.kind,
        selectedStepId: null,
        selectedOrderIndex: null,
        switchReasonCode: null,
        estimatedCostUsd: null,
        matchedCriteria: null,
        fallbackCandidates: null,
        stepChain: null
      };
    }

    throw new ProviderResolutionFailure({
      kind: failure.kind,
      userMessage: failure.userMessage,
      logContext: failure.logContext,
      cause: error
    });
  }
}
