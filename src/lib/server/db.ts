/**
 * SurrealDB client using stateless HTTP fetch.
 * Uses the SurrealDB HTTP SQL endpoint — no WebSocket, no persistent connection.
 * This works correctly in Cloud Run where container CPU is paused between requests.
 */

type DatabaseErrorCode =
	| 'db_connection'
	| 'db_timeout'
	| 'db_auth'
	| 'db_query'
	| 'db_config'
	| 'db_unknown';

export class DatabaseError extends Error {
	code: DatabaseErrorCode;
	cause?: unknown;

	constructor(code: DatabaseErrorCode, message: string, cause?: unknown) {
		super(message);
		this.name = 'DatabaseError';
		this.code = code;
		this.cause = cause;
	}
}

const DB_REQUEST_TIMEOUT_MS = Number(process.env.DB_REQUEST_TIMEOUT_MS || '10000');
const DB_MAX_RETRIES = Number(process.env.DB_MAX_RETRIES || '2');
const DB_RETRY_BASE_MS = Number(process.env.DB_RETRY_BASE_MS || '300');

// Normalise URL: strip any /rpc or /sql suffix so we always hit the root
function baseUrl(): string {
	const raw = process.env.SURREAL_URL || 'http://127.0.0.1:8000';
	const normalizedScheme = raw.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
	return normalizedScheme.replace(/\/rpc\/?$/, '').replace(/\/sql\/?$/, '').replace(/\/$/, '');
}

function authHeader(): string {
	const user = process.env.SURREAL_USER || 'root';
	const pass = process.env.SURREAL_PASS || 'root';
	return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function ns(): string { return process.env.SURREAL_NAMESPACE || 'sophia'; }
function db(): string { return process.env.SURREAL_DATABASE || 'sophia'; }

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		msg.includes('econnrefused') ||
		msg.includes('econnreset') ||
		msg.includes('etimedout') ||
		msg.includes('ehostunreach') ||
		msg.includes('timeout') ||
		msg.includes('503') ||
		msg.includes('502') ||
		msg.includes('429')
	);
}

function classifyDatabaseError(error: unknown): DatabaseError {
	const msg = error instanceof Error ? error.message : String(error);
	const lower = msg.toLowerCase();

	if (lower.includes('authentication') || lower.includes('unauthorized') || lower.includes('401')) {
		return new DatabaseError('db_auth', `Database authentication failed: ${msg}`, error);
	}

	if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('etimedout')) {
		return new DatabaseError('db_timeout', `Database request timed out: ${msg}`, error);
	}

	if (
		lower.includes('econnrefused') ||
		lower.includes('econnreset') ||
		lower.includes('ehostunreach') ||
		lower.includes('database unavailable')
	) {
		return new DatabaseError('db_connection', `Database unavailable: ${msg}`, error);
	}

	if (lower.includes('query failed') || lower.includes('surrealdb http') || lower.includes('parse')) {
		return new DatabaseError('db_query', `Database query failed: ${msg}`, error);
	}

	return new DatabaseError('db_unknown', `Database operation failed: ${msg}`, error);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
}

/** Low-level: POST a SurrealQL query to /sql and return raw parsed JSON */
async function sqlFetch(sql: string, vars?: Record<string, unknown>): Promise<unknown[]> {
	if (!process.env.SURREAL_URL) {
		throw new DatabaseError(
			'db_config',
			'SURREAL_URL is not set. Configure the app environment before querying the database.'
		);
	}

	// Inline variables as SET statements so we can use $name params
	let body = sql;
	if (vars && Object.keys(vars).length > 0) {
		const sets = Object.entries(vars)
			.map(([k, v]) => `LET $${k} = ${JSON.stringify(v)};`)
			.join(' ');
		body = sets + ' ' + sql;
	}

	let lastError: unknown;
	for (let attempt = 0; attempt <= DB_MAX_RETRIES; attempt++) {
		try {
			const res = await fetchWithTimeout(
				`${baseUrl()}/sql`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'text/plain',
						'Accept': 'application/json',
						'Authorization': authHeader(),
						'surreal-ns': ns(),
						'surreal-db': db(),
					},
					body,
				},
				DB_REQUEST_TIMEOUT_MS
			);

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(`SurrealDB HTTP ${res.status}: ${text}`);
			}

			const results: Array<{ status: string; result?: unknown; detail?: string }> = await res.json();
			const meaningful = results.filter((r) => !(r.status === 'OK' && r.result === null));
			const last = meaningful[meaningful.length - 1] ?? results[results.length - 1];

			if (!last) return [];
			if (last.status !== 'OK') throw new Error(last.detail || `Query failed: ${last.status}`);
			return Array.isArray(last.result) ? last.result : [last.result];
		} catch (error) {
			lastError = error;
			if (attempt >= DB_MAX_RETRIES || !isRetryableNetworkError(error)) {
				break;
			}

			const waitMs = DB_RETRY_BASE_MS * Math.pow(2, attempt);
			console.warn(
				`[DB] transient failure attempt ${attempt + 1}/${DB_MAX_RETRIES + 1}; retrying in ${waitMs}ms`
			);
			await sleep(waitMs);
		}
	}

	throw classifyDatabaseError(lastError);
}

/** No-op: kept for API compatibility. HTTP mode has no persistent connection. */
export async function getDb(): Promise<void> {
	// HTTP mode: no persistent connection needed — each query is a self-contained fetch call
}

/** No-op: kept for API compatibility. HTTP mode has no persistent connection. */
export async function closeDb(): Promise<void> {
	// nothing to do
}

/**
 * Execute a SurrealQL query.
 * Returns the first result set (array of rows).
 */
export async function query<T = unknown>(
	sql: string,
	vars?: Record<string, unknown>
): Promise<T> {
	try {
		const rows = await sqlFetch(sql, vars);
		return rows as T;
	} catch (error) {
		console.error('[DB] Query failed:', { sql: sql.slice(0, 80), error });
		throw classifyDatabaseError(error);
	}
}

/** Insert a record. */
export async function create<T>(
	table: string,
	data: Record<string, unknown>
): Promise<T> {
	try {
		const rows = await sqlFetch('CREATE type::table($table) CONTENT $data', { table, data });
		return (Array.isArray(rows) ? rows[0] : rows) as T;
	} catch (error) {
		console.error('[DB] Create failed:', { table, error });
		throw classifyDatabaseError(error);
	}
}

/** Merge-update a record by its full ID string (e.g. "source:abc"). */
export async function update<T>(id: string, data: Record<string, unknown>): Promise<T> {
	try {
		const rows = await sqlFetch('UPDATE type::thing($id) MERGE $data RETURN AFTER', { id, data });
		return (Array.isArray(rows) ? rows[0] : rows) as T;
	} catch (error) {
		console.error('[DB] Update failed:', { id, error });
		throw classifyDatabaseError(error);
	}
}

/** Delete a record by its full ID string. */
export async function remove(id: string): Promise<void> {
	try {
		await sqlFetch('DELETE type::thing($id)', { id });
	} catch (error) {
		console.error('[DB] Delete failed:', { id, error });
		throw classifyDatabaseError(error);
	}
}

export function isDatabaseUnavailable(error: unknown): boolean {
	if (error instanceof DatabaseError) {
		return ['db_connection', 'db_timeout', 'db_auth', 'db_config'].includes(error.code);
	}
	const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		msg.includes('database unavailable') ||
		msg.includes('connection') ||
		msg.includes('timeout') ||
		msg.includes('suraledb http') ||
		msg.includes('surrealdb http')
	);
}

export function getDatabaseRuntimeConfig(): {
	url: string;
	namespace: string;
	database: string;
	timeoutMs: number;
	maxRetries: number;
	mode: 'http-sql';
} {
	return {
		url: baseUrl(),
		namespace: ns(),
		database: db(),
		timeoutMs: DB_REQUEST_TIMEOUT_MS,
		maxRetries: DB_MAX_RETRIES,
		mode: 'http-sql',
	};
}

export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
	const startedAt = Date.now();
	try {
		await sqlFetch('SELECT 1 AS ok');
		return { ok: true, latencyMs: Date.now() - startedAt };
	} catch (error) {
		return {
			ok: false,
			latencyMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
