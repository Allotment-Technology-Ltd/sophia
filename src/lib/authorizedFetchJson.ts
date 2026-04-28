import { getIdToken } from '$lib/authClient';

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function safeReadJson(res: Response): Promise<JsonRecord> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function errorMessageFromBody(body: JsonRecord, status: number): string {
  const error = typeof body.error === 'string' ? body.error : '';
  const detail = typeof body.detail === 'string' ? body.detail : '';
  const title = typeof body.title === 'string' ? body.title : '';
  return error || detail || title || `Request failed (${status})`;
}

export async function authorizedFetchJson<T = unknown>(
  input: string,
  init: RequestInit & { jsonBody?: unknown } = {}
): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error('Authentication required.');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const { jsonBody, ...rest } = init;
  if (jsonBody !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(input, {
    ...rest,
    headers,
    ...(jsonBody !== undefined ? { body: JSON.stringify(jsonBody) } : {})
  });

  const body = await safeReadJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  return body as unknown as T;
}

