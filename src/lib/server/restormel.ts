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

/** Enabled steps in route order on resolve/simulate success (`stepChain`). Keys ≥0.2.11 / contract 2026-03-26. */
export interface RestormelStepChainEntry {
  stepId: string;
  orderIndex: number;
  providerType: string | null;
  modelId: string | null;
  enabled: boolean;
  selected: boolean;
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
  /** Resolve/simulate contract: `2026-03-26` with Keys ≥0.2.11 (see RESTORMEL_RESOLVE_SIMULATE_CONTRACT_VERSION). */
  contractVersion?: string | null;
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
  stepChain?: RestormelStepChainEntry[] | null;
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
  /** When false, resolve should not select this route (draft / not published). */
  isPublished?: boolean | null;
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
import {
  isReasoningProvider,
  type ReasoningProvider
} from '@restormel/contracts/providers';
import type { ValidateRouteBindingResult } from '@restormel/keys/dashboard';
import { validateRouteBinding } from '@restormel/keys/dashboard';
import { readRestormelCatalogDataModels } from '$lib/server/restormelCatalogRows';

/** Use with the headless `resolve()` helper from `@restormel/keys/dashboard`; Sophia uses `restormelResolve` + thrown errors instead. */
export { isNoKeyAvailable, isResolveIncomplete } from '@restormel/keys/dashboard';

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

function parseStepChain(value: unknown): RestormelStepChainEntry[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.filter(isRecord).map((row) => ({
    stepId: typeof row.stepId === 'string' ? row.stepId : '',
    orderIndex: typeof row.orderIndex === 'number' ? row.orderIndex : 0,
    providerType: typeof row.providerType === 'string' ? row.providerType : null,
    modelId: typeof row.modelId === 'string' ? row.modelId : null,
    enabled: row.enabled !== false,
    selected: row.selected === true
  }));
  return rows.length > 0 ? rows : null;
}

/** Expected `contractVersion` on resolve/simulate success (Keys dashboard API). */
export const RESTORMEL_RESOLVE_SIMULATE_CONTRACT_VERSION = '2026-03-26';

function warnIfUnexpectedResolveContract(contractVersion: string | null | undefined): void {
  if (!contractVersion || contractVersion === RESTORMEL_RESOLVE_SIMULATE_CONTRACT_VERSION) return;
  if (process.env.NODE_ENV === 'test') return;
  console.warn(
    '[restormel] Unexpected resolve/simulate contractVersion:',
    contractVersion,
    'expected',
    RESTORMEL_RESOLVE_SIMULATE_CONTRACT_VERSION,
    '— upgrade @restormel/keys or confirm dashboard release notes.'
  );
}

function operatorMessageFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.userMessage === 'string' && payload.userMessage.trim()) {
    return payload.userMessage.trim();
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  return undefined;
}

function publishValidationSummary(payload: unknown): string | undefined {
  if (!isRecord(payload) || payload.error !== 'publish_validation_failed') return undefined;
  const errors = payload.errors;
  if (!Array.isArray(errors)) return undefined;
  const parts = errors
    .filter(isRecord)
    .map((e) => {
      const field = typeof e.field === 'string' ? e.field : '';
      const msg = typeof e.message === 'string' ? e.message : '';
      const stepId = typeof e.stepId === 'string' ? e.stepId : '';
      const order = typeof e.orderIndex === 'number' ? String(e.orderIndex) : '';
      const head = [stepId && `step=${stepId}`, order && `order=${order}`, field]
        .filter(Boolean)
        .join(' ');
      return head ? `${head}: ${msg || 'invalid'}` : msg;
    })
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.slice(0, 12).join('; ');
}

/** Per-row errors from `PUT|POST …/projects/{id}/models` (`project_models_validation_failed`, `errors[]`). */
function projectModelsValidationSummary(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (payload.error === 'publish_validation_failed') return undefined;
  const errors = payload.errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const parts = errors
    .map((e) => {
      if (typeof e === 'string') return e.trim().slice(0, 240);
      if (!isRecord(e)) return '';
      const pt = typeof e.providerType === 'string' ? e.providerType : '';
      const mid = typeof e.modelId === 'string' ? e.modelId : '';
      const msg =
        typeof e.message === 'string'
          ? e.message
          : typeof e.detail === 'string'
            ? e.detail
            : typeof e.reason === 'string'
              ? e.reason
              : '';
      const idx = typeof e.index === 'number' ? `[${e.index}]` : '';
      const head = pt && mid ? `${pt}/${mid}` : pt || mid || idx;
      const body = msg || (Object.keys(e).length ? JSON.stringify(e).slice(0, 200) : '');
      if (head && body) return `${head}: ${body}`;
      return head || body;
    })
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.slice(0, 32).join('; ');
}

function toResolveResult(value: unknown): RestormelResolveResult {
  if (!isRecord(value)) {
    throw new Error('Restormel resolve returned an invalid response payload');
  }

  return {
    ...value,
    contractVersion:
      typeof value.contractVersion === 'string' ? value.contractVersion : null,
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
    stepChain: parseStepChain(value.stepChain)
  };
}

function resolveUserMessage(code: string, violations: RestormelPolicyViolation[]): string {
  if (code === 'no_route') {
    return 'No Restormel route matches this workload/stage for the current environment. List routes in the dashboard or fix metadata.';
  }
  if (code === 'route_unpublished') {
    return 'The matching route exists but is not published. Publish it in Restormel Keys so version matches publishedVersion.';
  }
  if (code === 'route_disabled') {
    return 'The matching route is disabled in Restormel Keys. Enable it or pick another route.';
  }
  if (code === 'resolve_incomplete') {
    return 'Restormel selected a route step that is not executable (missing or unknown provider/model). Fix the route in Keys or check workspace keys.';
  }
  if (code === 'publish_validation_failed') {
    return 'Publish was rejected: one or more route steps failed validation. Review the detailed errors and fix steps before publishing again.';
  }
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
            : status === 409
              ? 'conflict'
            : status === 400
              ? 'bad_request'
              : 'request_failed';

  const publishSummary = publishValidationSummary(payload);
  const projectModelsSummary = projectModelsValidationSummary(payload);

  const duplicateOrderIndexDetail =
    isRecord(payload) && payload.error === 'duplicate_order_index'
      ? 'POST /steps appends to the route draft; this request would duplicate an orderIndex. Clear existing steps first (or use replace), then post the full chain.'
      : null;

  const conflictFallback =
    'Conflict (HTTP 409): the route may have been updated in Restormel Keys or another session. Refresh this page, then try Save routing again. If it persists, open the route in Keys and avoid concurrent edits.';

  const rawDetail = isRecord(payload) && typeof payload.detail === 'string' ? payload.detail.trim() : '';
  const rawMessage = isRecord(payload) && typeof payload.message === 'string' ? payload.message.trim() : '';
  const combinedProjectModels =
    projectModelsSummary && rawDetail
      ? `${rawDetail} — ${projectModelsSummary}`
      : projectModelsSummary || null;

  const detail =
    publishSummary ||
    duplicateOrderIndexDetail ||
    combinedProjectModels ||
    rawDetail ||
    rawMessage ||
    (isLikelyHtml
      ? `Upstream returned HTML instead of JSON (status ${status}). Check RESTORMEL_KEYS_BASE / RESTORMEL_BASE_URL and endpoint routing.`
      : payloadText
        ? payloadText.slice(0, 220)
        : status === 409
          ? conflictFallback
          : `Restormel request failed with status ${status}`);

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
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    projectId?: string;
    requireProjectId?: boolean;
  }
): Promise<T> {
  ensureRestormelConfig(options?.requireProjectId ?? true);

  const method = options?.method ?? 'GET';
  const hasBody = options?.body !== undefined;
  const url = `${RESTORMEL_DASHBOARD_API_BASE}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${RESTORMEL_GATEWAY_KEY}`,
      ...(hasBody || method === 'POST' || method === 'PUT' || method === 'PATCH'
        ? { 'Content-Type': 'application/json' }
        : {})
    },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {})
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
    const data = toResolveResult(payload.data);
    warnIfUnexpectedResolveContract(data.contractVersion);
    return { data };
  } catch (error) {
    if (error instanceof RestormelDashboardError) {
      const violations = isRecord(error.payload)
        ? parseViolations(error.payload.violations)
        : [];
      const fromPayload = operatorMessageFromPayload(error.payload);
      throw new RestormelResolveError({
        status: error.status,
        code: error.code,
        detail: error.detail,
        endpoint: error.endpoint,
        payload: error.payload,
        userMessage: fromPayload ?? resolveUserMessage(error.code, violations),
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

/**
 * List routes for the project. Omit `query` to return all routes (admin UI).
 * For ingestion discovery, pass `environmentId` + `workload: 'ingestion'` per Restormel Keys API.
 * @see https://restormel.dev — GET .../routes?environmentId=&workload=&stage=
 */
export async function restormelListRoutes(
  query?: {
    environmentId?: string;
    workload?: string;
    /** Omit or leave unset to list all stages; use empty string only if the API expects it for shared routes */
    stage?: string;
  }
): Promise<{ data: RestormelRouteRecord[] }> {
  const params = new URLSearchParams();
  if (query?.environmentId) params.set('environmentId', query.environmentId);
  if (query?.workload) params.set('workload', query.workload);
  if (query?.stage !== undefined) params.set('stage', query.stage);
  const qs = params.toString();
  return requestRestormel<{ data: RestormelRouteRecord[] }>(
    `${projectPath()}/routes${qs ? `?${qs}` : ''}`
  );
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

/**
 * Remove all steps from a route draft (Dashboard API). Use before re-posting a full chain when POST merges/appends.
 * If the deployment has no DELETE handler, this throws — callers may fall back to in-place updates only.
 */
export async function restormelDeleteRouteSteps(routeId: string): Promise<void> {
  await requestRestormel<{ data?: unknown }>(
    `${projectPath()}/routes/${encodeURIComponent(routeId)}/steps`,
    { method: 'DELETE' }
  );
}

export async function restormelDeleteRouteStep(routeId: string, stepId: string): Promise<void> {
  await requestRestormel<{ data?: unknown }>(
    `${projectPath()}/routes/${encodeURIComponent(routeId)}/steps/${encodeURIComponent(stepId)}`,
    { method: 'DELETE' }
  );
}

/**
 * Replace the full step chain. Dashboard POST /steps **appends**; without a bulk replace endpoint we clear
 * (bulk DELETE when available, else per-step DELETE) then POST the new chain.
 */
export async function restormelReplaceRouteSteps(
  routeId: string,
  steps: RestormelStepRecord[]
): Promise<{ data: RestormelStepRecord[] | RestormelStepRecord }> {
  const allowedProviders = new Set([
    'openai',
    'anthropic',
    'google',
    'openrouter',
    'vercel',
    'portkey',
    'voyage'
  ]);

  const normalizeProviderPreference = (value: unknown, modelId?: unknown): string | null => {
    const p = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const m = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
    const allowed = new Set([
      'openai',
      'anthropic',
      'google',
      'openrouter',
      'vercel',
      'portkey',
      'voyage'
    ]);

    if (allowed.has(p)) return p;
    if (!p) {
      if (m.includes('gemini') || m.includes('text-embedding') || m.includes('gecko')) return 'google';
      if (m.includes('claude')) return 'anthropic';
      if (m.includes('voyage')) return 'voyage';
      if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';
      return null;
    }

    if (p === 'vertex' || p.includes('vertex') || p.includes('google')) return 'google';
    if (p.includes('anthropic') || m.includes('claude')) return 'anthropic';
    if (p.includes('openrouter')) return 'openrouter';
    if (p.includes('portkey')) return 'portkey';
    if (p.includes('vercel')) return 'vercel';
    if (p.includes('voyage') || m.includes('voyage')) return 'voyage';
    if (p.includes('openai') || m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';

    return p;
  };

  try {
    await restormelDeleteRouteSteps(routeId);
  } catch {
    const { data } = await restormelListRouteSteps(routeId);
    const list = Array.isArray(data) ? data : [];
    for (const step of list) {
      const sid = typeof step.id === 'string' ? step.id.trim() : '';
      if (!sid) continue;
      try {
        await restormelDeleteRouteStep(routeId, sid);
      } catch (e) {
        if (e instanceof RestormelDashboardError && e.status === 404) continue;
        throw e;
      }
    }
  }
  const ordered = [...steps]
    .sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0))
    .map((step, idx) => {
      const provider = normalizeProviderPreference(step.providerPreference, step.modelId);
      if (!provider || !allowedProviders.has(provider)) {
        const model = typeof step.modelId === 'string' ? step.modelId : '';
        throw new Error(
          `Route step provider is unsupported for model "${model}". Allowed providers: openai, anthropic, google (alias: vertex), openrouter, vercel, portkey, voyage.`
        );
      }
      return {
        orderIndex: Number(step.orderIndex) || idx,
        enabled: step.enabled !== false,
        providerPreference: provider,
        modelId: step.modelId ?? null,
        ...(step.switchCriteria !== undefined ? { switchCriteria: step.switchCriteria } : {}),
        ...(step.retryPolicy !== undefined ? { retryPolicy: step.retryPolicy } : {}),
        ...(step.costPolicy !== undefined ? { costPolicy: step.costPolicy } : {})
      };
    });

  let last: { data: RestormelStepRecord[] | RestormelStepRecord } | null = null;
  for (const step of ordered) {
    last = await restormelSaveRouteSteps(routeId, step);
  }
  if (last) return last;
  return { data: [] };
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
): Promise<{ data: RestormelResolveResult }> {
  const raw = await requestRestormel<{ data: unknown }>(
    `${projectPath()}/routes/${encodeURIComponent(routeId)}/simulate`,
    {
      method: 'POST',
      body: payload
    }
  );
  const data = toResolveResult(raw.data);
  warnIfUnexpectedResolveContract(data.contractVersion);
  return { data };
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
 * Project model **index** (Gateway Key / dashboard): `GET …/projects/{projectId}/models`.
 * Canonical JSON: binding rows are the array at **`data`** (not `data.bindings`); see
 * restormel-keys `docs/restormel-integration/keys-catalog-sync.md` and OpenAPI 1.3.2+.
 * @see docs/restormel-integration/keys-catalog-sync.md
 */
export async function restormelListProjectModels(): Promise<unknown> {
  return requestRestormel<unknown>(`${projectPath()}/models`);
}

/**
 * Global dashboard model catalog: `GET …/models` (no project segment). Distinct from the per-project index.
 */
export async function restormelListGlobalDashboardModels(): Promise<unknown> {
  return requestRestormel<unknown>('/models', { requireProjectId: false });
}

/**
 * Per OpenAPI `ProjectModelBindingKind`: **execution** — canonical provider + catalog model + variants;
 * **registry** — host merge metadata / pickers only; arbitrary provider/model strings; does not extend Keys resolve or routes.
 */
export type RestormelProjectModelBindingKind = 'execution' | 'registry';

export type RestormelProjectModelBindingInput = {
  providerType: string;
  modelId: string;
  enabled?: boolean;
  /**
   * Omit or `execution` when the pair is Keys catalog-backed. `registry` for extra providers (e.g. mistral, deepseek)
   * or ids without a catalog row — index accepts them; execution stack unchanged until Keys adds product support.
   */
  bindingKind?: RestormelProjectModelBindingKind;
};

/** Batch add bindings (idempotent). Gateway: `POST …/projects/{id}/models` body `{ models: [...] }`. */
export async function restormelAddProjectModelBindings(
  models: RestormelProjectModelBindingInput[]
): Promise<unknown> {
  return requestRestormel<unknown>(`${projectPath()}/models`, {
    method: 'POST',
    body: { models }
  });
}

/** Replace full project allowlist; empty `models` clears. `PUT …/projects/{id}/models`. */
export async function restormelReplaceProjectModelAllowlist(
  models: RestormelProjectModelBindingInput[]
): Promise<unknown> {
  return requestRestormel<unknown>(`${projectPath()}/models`, {
    method: 'PUT',
    body: { models }
  });
}

/** Soft enable/disable a binding. `PATCH …/projects/{id}/models/{bindingId}` */
export async function restormelPatchProjectModelBinding(
  bindingId: string,
  body: { enabled: boolean }
): Promise<unknown> {
  return requestRestormel<unknown>(
    `${projectPath()}/models/${encodeURIComponent(bindingId)}`,
    { method: 'PATCH', body }
  );
}

/** Hard delete a binding. `DELETE …/projects/{id}/models/{bindingId}` */
export async function restormelDeleteProjectModelBinding(bindingId: string): Promise<unknown> {
  return requestRestormel<unknown>(`${projectPath()}/models/${encodeURIComponent(bindingId)}`, {
    method: 'DELETE'
  });
}

export const RESTORMEL_CATALOG_V5_CONTRACT_VERSION = '2026-03-25.catalog.v5';
const LIVE_ALLOWLIST_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LIVE_ALLOWLIST_REFRESH_MIN_INTERVAL_MS = 60 * 1000;

type LiveAllowlistSnapshot = {
  contractVersion: string;
  fetchedAt: number;
  allFresh: boolean;
  allowlist: Partial<Record<ReasoningProvider, Set<string>>>;
};

let lastLiveAllowlistAttemptAt = 0;
let liveAllowlistSnapshot: LiveAllowlistSnapshot | null = null;

function providerFromCatalog(raw: unknown): ReasoningProvider | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  const mapped = normalized === 'google' ? 'vertex' : normalized;
  return isReasoningProvider(mapped) ? mapped : null;
}

function readModelRows(payload: unknown): Array<Record<string, unknown>> {
  return readRestormelCatalogDataModels(payload);
}

function isDefaultAllowlisted(row: Record<string, unknown>): boolean {
  if (typeof row.defaultAllowlisted === 'boolean') return row.defaultAllowlisted;
  if (typeof row.defaultAllowlistAligned === 'boolean') return row.defaultAllowlistAligned;
  if (isRecord(row.allowlist) && typeof row.allowlist.default === 'boolean') {
    return row.allowlist.default;
  }
  if (isRecord(row.defaultAllowlist) && typeof row.defaultAllowlist.aligned === 'boolean') {
    return row.defaultAllowlist.aligned;
  }
  return true;
}

function parseCatalogAllowlist(payload: unknown): Partial<Record<ReasoningProvider, Set<string>>> {
  const allowlist: Partial<Record<ReasoningProvider, Set<string>>> = {};
  const rows = readModelRows(payload);
  for (const row of rows) {
    if (!isDefaultAllowlisted(row)) continue;
    const provider = providerFromCatalog(row.providerType ?? row.provider ?? row.providerId);
    if (!provider) continue;
    const modelIdRaw =
      row.providerModelId ??
      row.modelId ??
      row.model ??
      row.modelVariant ??
      row.variant ??
      row.id;
    const modelId = typeof modelIdRaw === 'string' ? modelIdRaw.trim() : '';
    if (!modelId) continue;
    const set = allowlist[provider] ?? new Set<string>();
    set.add(modelId);
    allowlist[provider] = set;
  }
  return allowlist;
}

function parseCatalogFreshness(payload: unknown): { allFresh: boolean } {
  const obj = isRecord(payload) ? payload : null;
  const data = isRecord(obj?.data) ? obj.data : null;
  const externalSignals = isRecord(data?.externalSignals) ? data.externalSignals : null;
  const freshness = isRecord(externalSignals?.freshness) ? externalSignals.freshness : null;
  return {
    allFresh: freshness?.allFresh === true
  };
}

function parseCatalogContractVersion(payload: unknown): string {
  const obj = isRecord(payload) ? payload : null;
  const data = isRecord(obj?.data) ? obj.data : null;
  const fromData = typeof data?.contractVersion === 'string' ? data.contractVersion.trim() : '';
  if (fromData) return fromData;
  const fromTop = typeof obj?.contractVersion === 'string' ? obj.contractVersion.trim() : '';
  return fromTop;
}

export async function restormelGetLiveReasoningAllowlist(): Promise<{
  allowlist: Partial<Record<ReasoningProvider, Set<string>>>;
  contractVersion: string;
  allFresh: boolean;
  source: 'live' | 'cached';
}> {
  const now = Date.now();
  const canRefresh = now - lastLiveAllowlistAttemptAt >= LIVE_ALLOWLIST_REFRESH_MIN_INTERVAL_MS;

  if (!canRefresh && liveAllowlistSnapshot) {
    return {
      allowlist: liveAllowlistSnapshot.allowlist,
      contractVersion: liveAllowlistSnapshot.contractVersion,
      allFresh: liveAllowlistSnapshot.allFresh,
      source: 'cached'
    };
  }

  lastLiveAllowlistAttemptAt = now;

  try {
    const payload = await requestRestormel<unknown>('/catalog', { requireProjectId: false });
    const contractVersion = parseCatalogContractVersion(payload);
    if (contractVersion !== RESTORMEL_CATALOG_V5_CONTRACT_VERSION) {
      throw new Error(
        `catalog_contract_mismatch:${contractVersion || 'missing'} expected=${RESTORMEL_CATALOG_V5_CONTRACT_VERSION}`
      );
    }
    const allowlist = parseCatalogAllowlist(payload);
    const { allFresh } = parseCatalogFreshness(payload);
    liveAllowlistSnapshot = {
      contractVersion,
      fetchedAt: now,
      allFresh,
      allowlist
    };
    return { allowlist, contractVersion, allFresh, source: 'live' };
  } catch (error) {
    if (liveAllowlistSnapshot && now - liveAllowlistSnapshot.fetchedAt <= LIVE_ALLOWLIST_CACHE_MAX_AGE_MS) {
      return {
        allowlist: liveAllowlistSnapshot.allowlist,
        contractVersion: liveAllowlistSnapshot.contractVersion,
        allFresh: liveAllowlistSnapshot.allFresh,
        source: 'cached'
      };
    }
    throw error;
  }
}

/** Fresh `GET /catalog` (no live-allowlist cache). Admin model surfaces + ingestion catalog. */
export async function restormelFetchCatalogPayloadUncached(): Promise<unknown> {
  return requestRestormel<unknown>('/catalog', { requireProjectId: false });
}

/**
 * Preflight: route metadata vs env / workload / stage (not policy or step evaluation).
 * Use from admin flows when you want a typed check before saving routing.
 */
export async function restormelValidateRouteBinding(options: {
  routeId: string;
  workload?: string | null;
  stage?: string | null;
  task?: string | null;
}): Promise<ValidateRouteBindingResult> {
  ensureRestormelConfig();
  return validateRouteBinding({
    baseUrl: RESTORMEL_BASE_URL,
    projectId: RESTORMEL_PROJECT_ID,
    environmentId: RESTORMEL_ENVIRONMENT_ID,
    routeId: options.routeId,
    workload: options.workload ?? undefined,
    stage: options.stage ?? undefined,
    task: options.task ?? undefined,
    auth: { type: 'bearer', token: RESTORMEL_GATEWAY_KEY }
  });
}

export async function restormelPostCatalogObservation(payload: {
  providerType: string;
  modelId: string;
  observationType: 'deprecation' | 'retirement';
  reason?: string;
  source?: string;
  routeId?: string | null;
}): Promise<void> {
  await requestRestormel<unknown>('/catalog/observations', {
    method: 'POST',
    body: payload,
    requireProjectId: false
  });
}
