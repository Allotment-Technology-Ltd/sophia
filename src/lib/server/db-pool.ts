/**
 * SurrealDB Connection Management & Retry Logic
 *
 * Provides:
 * - Connection pooling with health checks
 * - Automatic retry on transient failures
 * - Exponential backoff for rate limiting
 * - Connection validation before critical operations
 */

import { Surreal } from 'surrealdb';

export interface ConnectionConfig {
	url: string;
	username: string;
	password: string;
	namespace: string;
	database: string;
	poolSize?: number;
	healthCheckInterval?: number;
	idleTimeout?: number;
}

interface PooledConnection {
	db: Surreal;
	lastUsed: number;
	isHealthy: boolean;
	createdAt: number;
}

export class SurrealDBPool {
	private connections: Map<string, PooledConnection[]> = new Map();
	private config: ConnectionConfig;
	private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
	private readonly poolSize: number;
	private readonly maxIdleTime: number;

	constructor(config: ConnectionConfig) {
		this.config = {
			poolSize: 3,
			healthCheckInterval: 30000, // 30 seconds
			idleTimeout: 600000, // 10 minutes
			...config
		};
		this.poolSize = this.config.poolSize || 3;
		this.maxIdleTime = this.config.idleTimeout || 600000;

		this.startHealthCheckLoop();
	}

	/**
	 * Get or create a database connection from the pool
	 */
	async getConnection(): Promise<Surreal> {
		const key = `${this.config.namespace}:${this.config.database}`;
		let pool = this.connections.get(key);

		if (!pool) {
			pool = [];
			this.connections.set(key, pool);
		}

		// Return existing healthy connection
		for (let i = 0; i < pool.length; i++) {
			const conn = pool[i];
			if (conn.isHealthy && !this.isIdleTimeout(conn)) {
				conn.lastUsed = Date.now();
				return conn.db;
			}
		}

		// Create new connection if pool not full
		if (pool.length < this.poolSize) {
			const db = await this.createConnection();
			pool.push({
				db,
				lastUsed: Date.now(),
				isHealthy: true,
				createdAt: Date.now()
			});
			return db;
		}

		// Reuse least recently used connection
		const lru = pool.reduce((min, curr) =>
			curr.lastUsed < min.lastUsed ? curr : min
		);
		lru.lastUsed = Date.now();
		return lru.db;
	}

	/**
	 * Validate connection is still alive
	 */
	async validateConnection(db: Surreal): Promise<boolean> {
		try {
			const result = await db.query('SELECT 1 as health');
			return Array.isArray(result) && result.length > 0;
		} catch {
			return false;
		}
	}

	/**
	 * Create a new SurrealDB connection
	 */
	private async createConnection(): Promise<Surreal> {
		const db = new Surreal();

		try {
			await db.connect(this.config.url);
			await db.signin({
				username: this.config.username,
				password: this.config.password
			} as any);
			await db.use({
				namespace: this.config.namespace,
				database: this.config.database
			});

			return db;
		} catch (error) {
			console.error('[DB POOL] Failed to create connection:', error);
			throw error;
		}
	}

	/**
	 * Check if connection is idle (exceeded max idle time)
	 */
	private isIdleTimeout(conn: PooledConnection): boolean {
		return Date.now() - conn.lastUsed > this.maxIdleTime;
	}

	/**
	 * Health check loop — validates all connections periodically
	 */
	private startHealthCheckLoop(): void {
		this.healthCheckInterval = setInterval(async () => {
			for (const [, pool] of this.connections) {
				for (const conn of pool) {
					const isHealthy = await this.validateConnection(conn.db);
					conn.isHealthy = isHealthy;

					if (!isHealthy) {
						console.warn('[DB POOL] Connection marked unhealthy, will be replaced on next request');
					}
				}

				// Remove idle or unhealthy connections
				const before = pool.length;
				const filtered = pool.filter(
					(conn) =>
						conn.isHealthy &&
						!this.isIdleTimeout(conn)
				);
				if (filtered.length !== before) {
					console.log(`[DB POOL] Cleaned ${before - filtered.length} connections`);
				}
				this.connections.forEach((p, k) => {
					if (k === Object.keys({ '': 0 })[0]) return;
					p.splice(0, p.length, ...filtered);
				});
			}
		}, this.config.healthCheckInterval || 30000);
	}

	/**
	 * Close all connections and cleanup
	 */
	async close(): Promise<void> {
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
		}

		for (const [, pool] of this.connections) {
			for (const conn of pool) {
				try {
					await conn.db.close();
				} catch {
					// ignore
				}
			}
		}

		this.connections.clear();
	}
}

export interface RetryOptions {
	maxRetries?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	backoffMultiplier?: number;
}

/**
 * Execute a database query with automatic retry on transient failures
 */
export async function queryWithRetry<T>(
	db: Surreal,
	query: string,
	params?: any,
	options: RetryOptions = {}
): Promise<T> {
	const maxRetries = options.maxRetries ?? 3;
	const initialDelay = options.initialDelayMs ?? 500;
	const maxDelay = options.maxDelayMs ?? 15000;
	const backoff = options.backoffMultiplier ?? 2;

	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return (await db.query(query, params)) as T;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (attempt >= maxRetries) {
				break;
			}

			// Check if error is retryable (transient)
			if (!isRetryableError(lastError)) {
				throw lastError;
			}

			// Exponential backoff
			const delay = Math.min(
				initialDelay * Math.pow(backoff, attempt),
				maxDelay
			);

			console.warn(
				`[DB RETRY] Attempt ${attempt + 1}/${maxRetries + 1} — ` +
				`${lastError.message} (waiting ${delay}ms)`
			);

			await sleep(delay);
		}
	}

	throw new Error(
		`Database query failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`
	);
}

/**
 * Determine if an error is transient and retryable
 */
export function isRetryableError(error: Error): boolean {
	const msg = error.message.toLowerCase();

	// Network errors
	if (
		msg.includes('econnrefused') ||
		msg.includes('econnreset') ||
		msg.includes('etimedout') ||
		msg.includes('ehostunreach') ||
		msg.includes('timeout')
	) {
		return true;
	}

	// HTTP errors
	if (msg.includes('503') || msg.includes('502') || msg.includes('429')) {
		return true;
	}

	// DB-specific
	if (
		msg.includes('database unavailable') ||
		msg.includes('connection pool exhausted')
	) {
		return true;
	}

	return false;
}

/**
 * Simple sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
