export interface RestormelPolicyViolation {
  policyId?: string;
  policyName?: string;
  type?: string;
  message?: string;
}

export interface RestormelFallbackCandidate {
  stepId?: string | null;
  orderIndex?: number | null;
  providerType?: string | null;
  modelId?: string | null;
  [key: string]: unknown;
}

export interface ResolveRequest {
  environmentId: string;
  routeId?: string;
  workload?: string;
  stage?: string;
  task?: string;
  attempt?: number;
  estimatedInputTokens?: number;
  estimatedInputChars?: number;
  complexity?: string;
  constraints?: {
    latency?: string;
    maxCost?: number;
  };
  previousFailure?: {
    failureKind?: string;
    providerType?: string;
    modelId?: string;
    [key: string]: unknown;
  };
}

export interface EvaluateRequest {
  projectId?: string;
  environmentId: string;
  routeId?: string;
  modelId: string;
  providerType: string;
}

export interface RestormelResolveResult {
  routeId: string;
  providerType: string | null;
  modelId: string | null;
  explanation: string;
  selectedStepId?: string | null;
  selectedOrderIndex?: number | null;
  switchReasonCode?: string | null;
  estimatedCostUsd?: number | null;
  matchedCriteria?: unknown;
  fallbackCandidates?: RestormelFallbackCandidate[] | null;
  [key: string]: unknown;
}

export interface ResolveResponse {
  data: RestormelResolveResult;
}

export interface EvaluateResponse {
  data: {
    allowed: boolean;
    violations: RestormelPolicyViolation[];
  };
}

export interface RestormelRouteRecord {
  id: string;
  name?: string | null;
  environmentId?: string | null;
  workload?: string | null;
  stage?: string | null;
  enabled?: boolean | null;
  version?: number | null;
  publishedVersion?: number | null;
  [key: string]: unknown;
}

export interface RestormelStepRecord {
  id?: string;
  routeId?: string | null;
  orderIndex?: number | null;
  enabled?: boolean | null;
  providerPreference?: string | null;
  modelId?: string | null;
  switchCriteria?: Record<string, unknown> | null;
  retryPolicy?: Record<string, unknown> | null;
  costPolicy?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RestormelRouteHistoryEntry {
  id?: string;
  version?: number | null;
  publishedVersion?: number | null;
  createdAt?: string | null;
  publishedAt?: string | null;
  updatedBy?: string | null;
  publishedBy?: string | null;
  changeSummary?: string | null;
  [key: string]: unknown;
}

export interface RestormelProvidersHealthProvider {
  providerType?: string | null;
  status?: string | null;
  source?: string | null;
  [key: string]: unknown;
}

export interface RestormelProvidersHealthResponse {
  data: {
    providers: RestormelProvidersHealthProvider[];
    [key: string]: unknown;
  };
}

export interface RestormelRoutingCapabilitiesResponse {
  data: {
    workloads: string[];
    stages: string[];
    [key: string]: unknown;
  };
}

export interface RestormelSwitchCriteriaEnumsResponse {
  data: {
    onFailureKinds?: string[];
    complexity?: string[];
    latencyClass?: string[];
    [key: string]: unknown;
  };
}

export class RestormelDashboardError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly endpoint: string;
  readonly payload: unknown;

  constructor(options: {
    status: number;
    code: string;
    detail: string;
    endpoint: string;
    payload: unknown;
  }) {
    super(options.detail);
    this.name = 'RestormelDashboardError';
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
    this.endpoint = options.endpoint;
    this.payload = options.payload;
  }
}

export class RestormelResolveError extends RestormelDashboardError {
  readonly userMessage: string;
  readonly violations: RestormelPolicyViolation[];

  constructor(options: {
    status: number;
    code: string;
    detail: string;
    endpoint: string;
    payload: unknown;
    userMessage: string;
    violations?: RestormelPolicyViolation[];
  }) {
    super(options);
    this.name = 'RestormelResolveError';
    this.userMessage = options.userMessage;
    this.violations = options.violations ?? [];
  }
}

/** Dashboard JSON API is under `{origin}/keys/dashboard/api`, not `{origin}/api`. */
function isBareRestormelKeysOrigin(urlLike: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(urlLike) ? urlLike : `https://${urlLike}`);
    if (!u.hostname.endsWith('restormel.dev')) return false;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    // Mistaken bare host or `/api` only — not a full path like /keys/dashboard
    return path === '/' || path === '/api';
  } catch {
    return false;
  }
}

/** Normalize RESTORMEL_KEYS_BASE / RESTORMEL_BASE_URL to the Keys dashboard base (no trailing /api). */
export function normalizeRestormelBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://restormel.dev/keys/dashboard';
  if (/\/keys\/dashboard\/api$/i.test(trimmed)) {
    return trimmed.replace(/\/api$/i, '');
  }
  if (/\/keys\/dashboard$/i.test(trimmed)) {
    return trimmed;
  }
  if (/\/keys$/i.test(trimmed)) {
    return `${trimmed}/dashboard`;
  }
  const withoutTrailingApi = trimmed.replace(/\/api$/i, '');
  if (isBareRestormelKeysOrigin(withoutTrailingApi)) {
    const u = new URL(
      /^https?:\/\//i.test(withoutTrailingApi)
        ? withoutTrailingApi
        : `https://${withoutTrailingApi}`
    );
    return `${u.origin}/keys/dashboard`;
  }
  return withoutTrailingApi;
}

export const RESTORMEL_BASE_URL = normalizeRestormelBaseUrl(
  process.env.RESTORMEL_KEYS_BASE?.trim() ||
    process.env.RESTORMEL_BASE_URL?.trim() ||
    'https://restormel.dev/keys/dashboard'
);
export const RESTORMEL_DASHBOARD_API_BASE = `${RESTORMEL_BASE_URL}/api`;
export const RESTORMEL_ENVIRONMENT_ID =
  process.env.RESTORMEL_ENVIRONMENT_ID?.trim() || 'production';
const RESTORMEL_GATEWAY_KEY = process.env.RESTORMEL_GATEWAY_KEY?.trim() || '';
const RESTORMEL_PROJECT_ID = process.env.RESTORMEL_PROJECT_ID?.trim() || '';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseViolations(value: unknown): RestormelPolicyViolation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((violation) => ({
      policyId: typeof violation.policyId === 'string' ? violation.policyId : undefined,
      policyName: typeof violation.policyName === 'string' ? violation.policyName : undefined,
      type: typeof violation.type === 'string' ? violation.type : undefined,
      message: typeof violation.message === 'string' ? violation.message : undefined
    }));
}

function parseFallbackCandidates(value: unknown): RestormelFallbackCandidate[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map((candidate) => ({
    stepId: typeof candidate.stepId === 'string' ? candidate.stepId : null,
    orderIndex: typeof candidate.orderIndex === 'number' ? candidate.orderIndex : null,
    providerType: typeof candidate.providerType === 'string' ? candidate.providerType : null,
    modelId: typeof candidate.modelId === 'string' ? candidate.modelId : null,
    ...candidate
  }));
}

function toResolveResult(value: unknown): RestormelResolveResult {
  if (!isRecord(value)) {
    throw new Error('Restormel resolve returned an invalid response payload');
  }

  return {
    routeId: typeof value.routeId === 'string' ? value.routeId : '',
    providerType: typeof value.providerType === 'string' ? value.providerType : null,
    modelId: typeof value.modelId === 'string' ? value.modelId : null,
    explanation: typeof value.explanation === 'string' ? value.explanation : '',
    selectedStepId: typeof value.selectedStepId === 'string' ? value.selectedStepId : null,
    selectedOrderIndex:
      typeof value.selectedOrderIndex === 'number' ? value.selectedOrderIndex : null,
    switchReasonCode:
      typeof value.switchReasonCode === 'string' ? value.switchReasonCode : null,
    estimatedCostUsd:
      typeof value.estimatedCostUsd === 'number' ? value.estimatedCostUsd : null,
    matchedCriteria: value.matchedCriteria ?? null,
    fallbackCandidates: parseFallbackCandidates(value.fallbackCandidates),
    ...value
  };
}

function resolveUserMessage(code: string, violations: RestormelPolicyViolation[]): string {
  if (code === 'policy_blocked') {
    if (
      violations.some(
        (violation) => violation.type === 'budget_cap' || violation.type === 'token_cap'
      )
    ) {
      return 'AI model routing is temporarily unavailable because workspace usage limits were reached.';
    }
    return 'No permitted AI model route is currently available.';
  }
  if (code === 'no_key_available') {
    return 'AI model routing is temporarily unavailable because no provider key is configured.';
  }
  if (code === 'usage_limit_reached') {
    return 'AI model routing is temporarily unavailable because workspace usage limits were reached.';
  }
  if (code === 'unauthorized') {
    return 'AI model routing authentication failed.';
  }
  return 'AI model routing is temporarily unavailable right now.';
}

function ensureRestormelConfig(projectRequired = true): void {
  if (!RESTORMEL_GATEWAY_KEY) {
    throw new Error('RESTORMEL_GATEWAY_KEY is not configured');
  }
  if (projectRequired && !RESTORMEL_PROJECT_ID) {
    throw new Error('RESTORMEL_PROJECT_ID is not configured');
  }
}

async function parseRestormelBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json().catch(() => null);
  }
  return res.text().catch(() => '');
}

function toDashboardError(
  endpoint: string,
  status: number,
  payload: unknown
): RestormelDashboardError {
  const payloadText =
    typeof payload === 'string' && payload.trim() ? payload.trim() : null;
  const isLikelyHtml =
    payloadText !== null && /<(?:!doctype|html|head|body)\b/i.test(payloadText);

  const code =
    isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : isLikelyHtml
        ? 'upstream_non_json'
      : status === 401
        ? 'unauthorized'
        : status === 403
          ? 'forbidden'
          : status === 404
            ? 'not_found'
            : status === 400
              ? 'bad_request'
              : 'request_failed';

  const detail =
    isRecord(payload) && typeof payload.detail === 'string'
      ? payload.detail
      : isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : isLikelyHtml
          ? `Upstream returned HTML instead of JSON (status ${status}). Check RESTORMEL_KEYS_BASE / RESTORMEL_BASE_URL and endpoint routing.`
          : payloadText
            ? payloadText.slice(0, 220)
          : `Restormel request failed with status ${status}`;

  return new RestormelDashboardError({
    status,
    code,
    detail,
    endpoint,
    payload
  });
}

async function requestRestormel<T>(
  endpoint: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: unknown;
    projectId?: string;
    requireProjectId?: boolean;
  }
): Promise<T> {
  ensureRestormelConfig(options?.requireProjectId ?? true);

  const url = `${RESTORMEL_DASHBOARD_API_BASE}${endpoint}`;
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${RESTORMEL_GATEWAY_KEY}`,
      'Content-Type': 'application/json'
    },
    ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });

  const payload = await parseRestormelBody(res);
  if (!res.ok) {
    throw toDashboardError(endpoint, res.status, payload);
  }

  return payload as T;
}

function projectPath(projectId?: string): string {
  return `/projects/${projectId ?? RESTORMEL_PROJECT_ID}`;
}

export async function restormelResolve(request: ResolveRequest): Promise<ResolveResponse> {
  try {
    const payload = await requestRestormel<{ data: unknown }>(`${projectPath()}/resolve`, {
      method: 'POST',
      body: request
    });
    return {
      data: toResolveResult(payload.data)
    };
  } catch (error) {
    if (error instanceof RestormelDashboardError) {
      const violations = isRecord(error.payload)
        ? parseViolations(error.payload.violations)
        : [];
      throw new RestormelResolveError({
        status: error.status,
        code: error.code,
        detail: error.detail,
        endpoint: error.endpoint,
        payload: error.payload,
        userMessage: resolveUserMessage(error.code, violations),
        violations
      });
    }
    throw error;
  }
}

export async function restormelEvaluatePolicies(
  request: EvaluateRequest
): Promise<EvaluateResponse> {
  if (!RESTORMEL_PROJECT_ID && !request.projectId) {
    throw new Error('RESTORMEL_PROJECT_ID is not configured');
  }

  return requestRestormel<EvaluateResponse>('/policies/evaluate', {
    method: 'POST',
    body: {
      projectId: request.projectId ?? RESTORMEL_PROJECT_ID,
      environmentId: request.environmentId,
      routeId: request.routeId,
      modelId: request.modelId,
      providerType: request.providerType
    },
    requireProjectId: false
  });
}

export async function restormelListRoutes(): Promise<{ data: RestormelRouteRecord[] }> {
  return requestRestormel<{ data: RestormelRouteRecord[] }>(`${projectPath()}/routes`);
}

export async function restormelSaveRoute(
  payload: Record<string, unknown>
): Promise<{ data: RestormelRouteRecord }> {
  return requestRestormel<{ data: RestormelRouteRecord }>(`${projectPath()}/routes`, {
    method: 'POST',
    body: payload
  });
}

export async function restormelListRouteSteps(
  routeId: string
): Promise<{ data: RestormelStepRecord[] }> {
  return requestRestormel<{ data: RestormelStepRecord[] }>(
    `${projectPath()}/routes/${encodeURIComponent(routeId)}/steps`
  );
}

export async function restormelSaveRouteSteps(
  routeId: string,
  payload: Record<string, unknown> | RestormelStepRecord[] | RestormelStepRecord
): Promise<{ data: RestormelStepRecord[] | RestormelStepRecord }> {
  return requestRestormel<{ data: RestormelStepRecord[] | RestormelStepRecord }>(
    `${projectPath()}/routes/${encodeURIComponent(routeId)}/steps`,
    {
      method: 'POST',
      body: payload
    }
  );
}

export async function restormelSimulateRoute(
  routeId: string,
  payload: Record<string, unknown>
): Promise<{ data: Record<string, unknown> }> {
  return requestRestormel<{ data: Record<string, unknown> }>(
    `${projectPath()}/routes/${encodeURIComponent(routeId)}/simulate`,
    {
      method: 'POST',
      body: payload
    }
  );
}

export async function restormelPublishRoute(
  routeId: string,
  payload?: Record<string, unknown>
): Promise<{ data: Record<string, unknown> }> {
  return requestRestormel<{ data: Record<string, unknown> }>(
    `${projectPath()}/routes/${encodeURIComponent(routeId)}/publish`,
    {
      method: 'POST',
      body: payload ?? {}
    }
  );
}

export async function restormelRollbackRoute(
  routeId: string,
  payload?: Record<string, unknown>
): Promise<{ data: Record<string, unknown> }> {
  return requestRestormel<{ data: Record<string, unknown> }>(
    `${projectPath()}/routes/${encodeURIComponent(routeId)}/rollback`,
    {
      method: 'POST',
      body: payload ?? {}
    }
  );
}

export async function restormelGetRouteHistory(
  routeId: string
): Promise<{ data: RestormelRouteHistoryEntry[] }> {
  return requestRestormel<{ data: RestormelRouteHistoryEntry[] }>(
    `${projectPath()}/routes/${encodeURIComponent(routeId)}/history`
  );
}

export async function restormelGetProvidersHealth(): Promise<RestormelProvidersHealthResponse> {
  return requestRestormel<RestormelProvidersHealthResponse>(
    `${projectPath()}/providers/health`
  );
}

export async function restormelGetRoutingCapabilities(): Promise<RestormelRoutingCapabilitiesResponse> {
  return requestRestormel<RestormelRoutingCapabilitiesResponse>(
    `${projectPath()}/routing-capabilities`
  );
}

export async function restormelGetSwitchCriteriaEnums(): Promise<RestormelSwitchCriteriaEnumsResponse> {
  return requestRestormel<RestormelSwitchCriteriaEnumsResponse>(
    `${projectPath()}/switch-criteria-enums`
  );
}

/**
 * Project model index (Restormel Dashboard). Shape may vary; callers should parse defensively.
 * @see docs/restormel-integration/ingestion-control-plane-spec.md — metadata endpoint
 */
export async function restormelListProjectModels(): Promise<unknown> {
  return requestRestormel<unknown>(`${projectPath()}/models`);
}
