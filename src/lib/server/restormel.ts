export interface ResolveRequest {
  environmentId: string;
  routeId?: string;
}

export interface EvaluateRequest {
  projectId?: string;
  environmentId: string;
  routeId?: string;
  modelId: string;
  providerType: string;
}

export interface ResolveResponse {
  data: {
    routeId: string;
    providerType: string | null;
    modelId: string | null;
    explanation: string;
  };
}

export interface EvaluateResponse {
  data: {
    allowed: boolean;
    violations: RestormelPolicyViolation[];
  };
}

export interface RestormelPolicyViolation {
  policyId?: string;
  policyName?: string;
  type?: string;
  message?: string;
}

export class RestormelResolveError extends Error {
  readonly status: number;
  readonly code: string;
  readonly userMessage: string;
  readonly violations: RestormelPolicyViolation[];

  constructor(options: {
    status: number;
    code: string;
    detail: string;
    userMessage: string;
    violations?: RestormelPolicyViolation[];
  }) {
    super(options.detail);
    this.name = 'RestormelResolveError';
    this.status = options.status;
    this.code = options.code;
    this.userMessage = options.userMessage;
    this.violations = options.violations ?? [];
  }
}

const RESTORMEL_BASE_URL =
  process.env.RESTORMEL_KEYS_BASE?.trim() ||
  process.env.RESTORMEL_BASE_URL?.trim() ||
  'https://restormel.dev/keys/dashboard';
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

function resolveUserMessage(code: string, violations: RestormelPolicyViolation[]): string {
  if (code === 'policy_blocked') {
    if (violations.some((violation) => violation.type === 'budget_cap' || violation.type === 'token_cap')) {
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

export async function restormelResolve(
  request: ResolveRequest
): Promise<ResolveResponse> {
  if (!RESTORMEL_GATEWAY_KEY) {
    throw new Error('RESTORMEL_GATEWAY_KEY is not configured');
  }
  if (!RESTORMEL_PROJECT_ID) {
    throw new Error('RESTORMEL_PROJECT_ID is not configured');
  }

  const url = `${RESTORMEL_BASE_URL}/api/projects/${RESTORMEL_PROJECT_ID}/resolve`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESTORMEL_GATEWAY_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  });

  if (!res.ok) {
    const contentType = res.headers.get('content-type') ?? '';
    const rawBody = contentType.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text().catch(() => '');
    const payload = isRecord(rawBody) ? rawBody : null;
    const code =
      typeof payload?.error === 'string'
        ? payload.error
        : res.status === 401
          ? 'unauthorized'
          : 'resolve_failed';
    const detail =
      typeof payload?.message === 'string'
        ? payload.message
        : typeof payload?.detail === 'string'
          ? payload.detail
          : typeof rawBody === 'string' && rawBody.trim()
            ? rawBody.trim().slice(0, 200)
            : `Restormel resolve failed with status ${res.status}`;
    const violations = parseViolations(payload?.violations);
    throw new RestormelResolveError({
      status: res.status,
      code,
      detail,
      userMessage: resolveUserMessage(code, violations),
      violations
    });
  }

  return res.json() as Promise<ResolveResponse>;
}

export async function restormelEvaluatePolicies(
  request: EvaluateRequest
): Promise<EvaluateResponse> {
  if (!RESTORMEL_GATEWAY_KEY) {
    throw new Error('RESTORMEL_GATEWAY_KEY is not configured');
  }
  if (!RESTORMEL_PROJECT_ID && !request.projectId) {
    throw new Error('RESTORMEL_PROJECT_ID is not configured');
  }

  const url = `${RESTORMEL_BASE_URL}/api/policies/evaluate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESTORMEL_GATEWAY_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      projectId: request.projectId ?? RESTORMEL_PROJECT_ID,
      environmentId: request.environmentId,
      routeId: request.routeId,
      modelId: request.modelId,
      providerType: request.providerType
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Restormel evaluate failed (${res.status}): ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<EvaluateResponse>;
}
