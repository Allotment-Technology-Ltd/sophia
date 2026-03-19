import { isReasoningProvider, type ModelProvider, type ReasoningProvider } from '@restormel/contracts/providers';
import { RestormelResolveError, restormelResolve } from './restormel';

function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

export const USE_RESTORMEL_KEYS = parseBooleanFlag(
  process.env.USE_RESTORMEL_KEYS,
  false
);

const RESTORMEL_ENVIRONMENT_ID =
  process.env.RESTORMEL_ENVIRONMENT_ID?.trim() || 'production';

export interface ProviderDecision {
  provider: ReasoningProvider;
  model: string | null;
  source: 'restormel' | 'legacy';
  routeId?: string | null;
  explanation?: string | null;
}

type ResolveFailureKind =
  | 'budget_cap'
  | 'no_key_available'
  | 'policy_blocked'
  | 'network_or_auth'
  | 'unknown';

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
  legacy: () => ProviderDecision;
  preferredProvider?: ModelProvider;
  preferredModel?: string;
  routeId?: string;
}): Promise<ProviderDecision> {
  if (!USE_RESTORMEL_KEYS) {
    return options.legacy();
  }

  if (options.preferredProvider && options.preferredProvider !== 'auto') {
    return options.legacy();
  }

  try {
    const result = await restormelResolve({
      environmentId: RESTORMEL_ENVIRONMENT_ID,
      routeId: options.routeId
    });
    const providerType = normalizeRestormelProvider(result.data.providerType);
    if (!providerType) {
      console.error(
        '[restormel] Resolve returned an unsupported provider, falling back to legacy:',
        result.data.providerType
      );
      return options.legacy();
    }

    return {
      provider: providerType,
      model: result.data.modelId ?? options.preferredModel ?? null,
      source: 'restormel',
      routeId: result.data.routeId,
      explanation: result.data.explanation
    };
  } catch (error) {
    const failure = classifyResolveFailure(error);
    if (failure.kind === 'budget_cap') {
      console.error(
        '[restormel] Usage policy blocked model routing; using legacy fallback',
        failure.logContext
      );
      // Hook alerts here if budget or token caps should page operators during rollout.
    } else if (failure.kind === 'no_key_available') {
      console.warn(
        '[restormel] No provider key available for Restormel route; using legacy fallback',
        failure.logContext
      );
    } else if (failure.kind === 'policy_blocked') {
      console.warn(
        '[restormel] Policy blocked all Restormel route steps; using legacy fallback',
        failure.logContext
      );
    } else {
      console.error(
        '[restormel] Resolve failed before a safe route was selected; using legacy fallback',
        failure.logContext
      );
    }
    return options.legacy();
  }
}
