import { isReasoningProvider, type ModelProvider, type ReasoningProvider } from '@restormel/contracts/providers';
import {
  RESTORMEL_ENVIRONMENT_ID,
  RestormelResolveError,
  type ResolveRequest,
  type RestormelFallbackCandidate,
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
}

export type ResolveFailureKind =
  | 'budget_cap'
  | 'no_key_available'
  | 'policy_blocked'
  | 'network_or_auth'
  | 'unknown';

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
    if (error.code === 'policy_blocked') {
      return {
        kind: 'policy_blocked',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status, policyTypes }
      };
    }
    if (error.code === 'unauthorized' || error.status === 401 || error.status === 403) {
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
  if (options.preferredProvider && options.preferredProvider !== 'auto') {
    return {
      provider: options.preferredProvider,
      model: options.preferredModel?.trim() || null,
      source: 'requested',
      routeId: options.routeId ?? null,
      explanation: options.preferredModel?.trim()
        ? `User selected ${options.preferredProvider}/${options.preferredModel.trim()}.`
        : `User selected ${options.preferredProvider}.`
    };
  }

  try {
    const result = await restormelResolve({
      environmentId: RESTORMEL_ENVIRONMENT_ID,
      routeId: options.routeId,
      ...options.restormelContext
    });
    const providerType = normalizeRestormelProvider(result.data.providerType);
    if (!providerType) {
      throw new ProviderResolutionFailure({
        kind: 'unknown',
        userMessage: 'AI model routing returned an unsupported provider.',
        logContext: { providerType: result.data.providerType }
      });
    }

    return {
      provider: providerType,
      model: result.data.modelId ?? options.preferredModel ?? null,
      source: 'restormel',
      routeId: result.data.routeId,
      explanation: result.data.explanation,
      selectedStepId: result.data.selectedStepId ?? null,
      selectedOrderIndex: result.data.selectedOrderIndex ?? null,
      switchReasonCode: result.data.switchReasonCode ?? null,
      estimatedCostUsd: result.data.estimatedCostUsd ?? null,
      matchedCriteria: result.data.matchedCriteria ?? null,
      fallbackCandidates: result.data.fallbackCandidates ?? null
    };
  } catch (error) {
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
        fallbackCandidates: null
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
