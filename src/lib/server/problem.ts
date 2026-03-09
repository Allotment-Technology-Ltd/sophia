import { randomUUID } from 'node:crypto';

export interface ProblemOptions {
  status: number;
  title: string;
  detail?: string;
  type?: string;
  instance?: string;
  requestId?: string;
  headers?: HeadersInit;
  extensions?: Record<string, unknown>;
}

export function buildRequestId(): string {
  return randomUUID();
}

export function resolveRequestId(request?: Request | null): string {
  if (!request) return buildRequestId();
  const fromZuplo = request.headers.get('x-zuplo-request-id')?.trim();
  const fromRequest = request.headers.get('x-request-id')?.trim();
  return fromZuplo || fromRequest || buildRequestId();
}

export function problemJson(options: ProblemOptions): Response {
  const requestId = options.requestId ?? buildRequestId();
  const body = {
    type: options.type ?? 'about:blank',
    title: options.title,
    status: options.status,
    detail: options.detail,
    instance: options.instance,
    request_id: requestId,
    ...(options.extensions ?? {})
  };

  return new Response(JSON.stringify(body), {
    status: options.status,
    headers: {
      'Content-Type': 'application/problem+json',
      'X-Request-Id': requestId,
      ...(options.headers ?? {})
    }
  });
}
