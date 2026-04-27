import { isReasoningProvider, type ModelProvider, type ReasoningProvider } from '@restormel/contracts/providers';
import {
  RESTORMEL_ENVIRONMENT_ID,
  RestormelResolveError,
  type ResolveRequest,
  type RestormelFallbackCandidate,
  type RestormelRouteRecord,
  type RestormelStepChainEntry,
  restormelListRoutes,
  restormelListRouteSteps,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLikelyRestormelKeysEnvironmentId(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return UUID_RE.test(value.trim());
}

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
  const code =
    typeof failure.logContext?.code === 'string' ? failure.logContext.code : undefined;
  const noRoute = code === 'no_route' || code === 'route_unpublished' || code === 'route_disabled';
  const envHint = !isLikelyRestormelKeysEnvironmentId(RESTORMEL_ENVIRONMENT_ID)
    ? ` **RESTORMEL_ENVIRONMENT_ID** is set to "${RESTORMEL_ENVIRONMENT_ID}"; Restormel resolve expects the Keys **environment UUID** (dashboard), not a label like "production". A wrong id commonly yields 404 / no_route.`
    : '';
  const finetuneHint = noRoute
    ? ' With `INGEST_FINETUNE_LABELER_STRICT=1` (default), **OpenAI** `degraded_default` models (gpt-4o-mini) are not allowed for extraction; fix Restormel routes/UUID first. Emergency override: `INGEST_FINETUNE_LABELER_STRICT=0` (or add `openai` to `INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS` / set `EXTRACTION_BASE_URL` per docs).'
    : '';
  console.warn(
    '[restormel] Ingestion routing degraded — operator checklist: ' +
      `${stageLine} ` +
      'Publish routes (publishedVersion must match version). ' +
      'Verify RESTORMEL_PROJECT_ID, RESTORMEL_ENVIRONMENT_ID, RESTORMEL_GATEWAY_KEY (rk_…). ' +
      `Resolve detail: kind=${failure.kind} ` +
      `context=${JSON.stringify({ ...failure.logContext, restormelEnvironmentId: RESTORMEL_ENVIRONMENT_ID, workload: restormelContext?.workload, stage: restormelContext?.stage })}. ` +
      'Sophia: src/lib/server/restormelIngestionRoutes.ts' +
      (envHint ? ' ' + envHint : '') +
      (finetuneHint ? ' ' + finetuneHint : '')
  );
}

function normalizeRouteMeta(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function routePublishState(route: RestormelRouteRecord): string {
  if (route.enabled === false) return 'disabled';
  if (route.isPublished === false) return 'unpublished';
  if (typeof route.publishedVersion === 'number' && route.publishedVersion <= 0) return 'unpublished';
  if (
    typeof route.version === 'number' &&
    typeof route.publishedVersion === 'number' &&
    route.version !== route.publishedVersion
  ) {
    return `draft_ahead(version=${route.version},published=${route.publishedVersion})`;
  }
  return 'published';
}

function summarizeRoutesForNoRoute(
  routes: RestormelRouteRecord[],
  context: Omit<ResolveRequest, 'environmentId' | 'routeId'>,
  requestedRouteId?: string
): Record<string, unknown> {
  const requestedStage = normalizeRouteMeta(context.stage);
  const routeId = requestedRouteId?.trim();
  const ingestionRoutes = routes.filter((route) => normalizeRouteMeta(route.workload) === 'ingestion');
  const stageMatches = requestedStage
    ? ingestionRoutes.filter((route) => normalizeRouteMeta(route.stage) === requestedStage)
    : [];
  const sharedMatches = ingestionRoutes.filter((route) => !normalizeRouteMeta(route.stage));
  const routeIdMatches = routeId ? routes.filter((route) => route.id === routeId) : [];
  const stagesSeen = Array.from(
    new Set(ingestionRoutes.map((route) => normalizeRouteMeta(route.stage) || '(shared)'))
  ).sort();

  const compact = (route: RestormelRouteRecord) => ({
    id: route.id,
    name: route.name ?? null,
    workload: route.workload ?? null,
    stage: route.stage ?? null,
    state: routePublishState(route),
    version: route.version ?? null,
    publishedVersion: route.publishedVersion ?? null
  });

  return {
    environmentId: RESTORMEL_ENVIRONMENT_ID,
    requestedRouteId: routeId || null,
    requestedWorkload: context.workload ?? null,
    requestedStage: context.stage ?? null,
    listedRouteCount: routes.length,
    ingestionRouteCount: ingestionRoutes.length,
    stagesSeen: stagesSeen.slice(0, 20),
    routeIdMatches: routeIdMatches.slice(0, 5).map(compact),
    stageMatches: stageMatches.slice(0, 5).map(compact),
    sharedMatches: sharedMatches.slice(0, 5).map(compact)
  };
}

function summarizeRouteSteps(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, 8).map((step) => ({
    id: typeof step.id === 'string' ? step.id : null,
    orderIndex: typeof step.orderIndex === 'number' ? step.orderIndex : null,
    enabled: step.enabled !== false,
    providerPreference:
      typeof step.providerPreference === 'string' ? step.providerPreference : null,
    providerType: typeof step.providerType === 'string' ? step.providerType : null,
    modelId: typeof step.modelId === 'string' ? step.modelId : null
  }));
}

async function summarizeStepsForRoutes(routes: RestormelRouteRecord[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const route of routes) {
    const id = typeof route.id === 'string' ? route.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const { data } = await restormelListRouteSteps(id);
      out[id] = summarizeRouteSteps(data);
    } catch (error) {
      out[id] = {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  return out;
}

async function logRestormelNoRouteInventory(options: {
  routeId?: string;
  restormelContext?: Omit<ResolveRequest, 'environmentId' | 'routeId'>;
}): Promise<void> {
  const context = options.restormelContext;
  if (context?.workload !== 'ingestion') return;
  try {
    const { data } = await restormelListRoutes({
      environmentId: RESTORMEL_ENVIRONMENT_ID,
      workload: 'ingestion'
    });
    const routes = Array.isArray(data) ? data : [];
    const requestedStage = normalizeRouteMeta(context.stage);
    const requestedRouteId = options.routeId?.trim();
    const relevantRoutes = routes
      .filter((route) => {
        const workload = normalizeRouteMeta(route.workload);
        if (requestedRouteId && route.id === requestedRouteId) return true;
        if (workload !== 'ingestion') return false;
        const stage = normalizeRouteMeta(route.stage);
        return (requestedStage && stage === requestedStage) || !stage;
      })
      .slice(0, 8);
    console.warn(
      '[restormel] no_route diagnostics — route inventory visible to Sophia',
      {
        ...summarizeRoutesForNoRoute(routes, context, options.routeId),
        stepsByRoute: await summarizeStepsForRoutes(relevantRoutes)
      }
    );
  } catch (diagnosticError) {
    console.warn('[restormel] no_route diagnostics failed to list routes', {
      environmentId: RESTORMEL_ENVIRONMENT_ID,
      workload: context.workload,
      stage: context.stage ?? null,
      routeId: options.routeId ?? null,
      error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
    });
  }
}

function compactResolvePayloadRows(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter(isRecord).slice(0, 12).map((row) => ({
    stepId: typeof row.stepId === 'string' ? row.stepId : undefined,
    orderIndex: typeof row.orderIndex === 'number' ? row.orderIndex : undefined,
    providerType: typeof row.providerType === 'string' ? row.providerType : undefined,
    providerPreference:
      typeof row.providerPreference === 'string' ? row.providerPreference : undefined,
    modelId: typeof row.modelId === 'string' ? row.modelId : undefined,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : undefined,
    selected: typeof row.selected === 'boolean' ? row.selected : undefined,
    message: typeof row.message === 'string' ? row.message : undefined,
    detail: typeof row.detail === 'string' ? row.detail : undefined,
    reason: typeof row.reason === 'string' ? row.reason : undefined
  }));
  return rows.length > 0 ? rows : undefined;
}

function resolveErrorDiagnostics(error: RestormelResolveError): Record<string, unknown> {
  if (!isRecord(error.payload)) return {};
  const data = isRecord(error.payload.data) ? error.payload.data : error.payload;
  const out: Record<string, unknown> = {};
  for (const key of ['routeId', 'providerType', 'providerPreference', 'modelId', 'selectedStepId']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) out[key] = value;
  }
  const fallbackCandidates = compactResolvePayloadRows(data.fallbackCandidates);
  if (fallbackCandidates) out.fallbackCandidates = fallbackCandidates;
  const stepChain = compactResolvePayloadRows(data.stepChain);
  if (stepChain) out.stepChain = stepChain;
  const errors = compactResolvePayloadRows(data.errors);
  if (errors) out.errors = errors;
  return out;
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
    const details = resolveErrorDiagnostics(error);
    const policyTypes = error.violations
      .map((violation) => violation.type?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
    const hasBudgetCap =
      policyTypes.includes('budget_cap') || policyTypes.includes('token_cap');
    if (error.code === 'policy_blocked' && hasBudgetCap) {
      return {
        kind: 'budget_cap',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status, policyTypes, ...details }
      };
    }
    if (error.code === 'no_key_available') {
      return {
        kind: 'no_key_available',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status, ...details }
      };
    }
    if (error.code === 'resolve_incomplete') {
      return {
        kind: 'unknown',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status, ...details }
      };
    }
    if (error.code === 'policy_blocked') {
      return {
        kind: 'policy_blocked',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status, policyTypes, ...details }
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
        logContext: { code: error.code, status: error.status, ...details }
      };
    }
    if (error.code === 'unauthorized' || error.status === 401) {
      return {
        kind: 'network_or_auth',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status, ...details }
      };
    }
    if (error.status === 403) {
      return {
        kind: 'network_or_auth',
        userMessage: error.userMessage,
        logContext: { code: error.code, status: error.status, ...details }
      };
    }
    return {
      kind: 'unknown',
      userMessage: error.userMessage,
      logContext: { code: error.code, status: error.status, ...details }
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
      await logRestormelNoRouteInventory({
        routeId: options.routeId,
        restormelContext: options.restormelContext
      });
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
