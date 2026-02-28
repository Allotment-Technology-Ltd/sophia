import { Surreal } from 'surrealdb';
import {
	SURREAL_URL,
	SURREAL_USER,
	SURREAL_PASS,
	SURREAL_NAMESPACE,
	SURREAL_DATABASE
} from '$env/static/private';

let dbInstance: Surreal | null = null;
let isConnecting = false;

/**
 * Get or initialize the SurrealDB connection
 * Implements singleton pattern with lazy initialization
 */
export async function getDb(): Promise<Surreal> {
	// Return existing connection
	if (dbInstance) {
		return dbInstance;
	}

	// Prevent multiple simultaneous connection attempts
	if (isConnecting) {
		// Wait for the connection to complete
		let attempts = 0;
		while (isConnecting && attempts < 100) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			attempts++;
		}
		if (dbInstance) {
			return dbInstance;
		}
	}

	try {
		isConnecting = true;

		console.log('[DB] Initializing SurrealDB connection...');

		// Create new connection
		dbInstance = new Surreal();

		// Connect to database
		await dbInstance.connect(SURREAL_URL);
		console.log(`[DB] Connected to ${SURREAL_URL}`);

		// Sign in with credentials
		await dbInstance.signin({
			username: SURREAL_USER,
			password: SURREAL_PASS
		} as any);
		console.log('[DB] Authenticated successfully');

		// Select namespace and database
		await dbInstance.use({
			namespace: SURREAL_NAMESPACE,
			database: SURREAL_DATABASE
		});
		console.log(`[DB] Using namespace: ${SURREAL_NAMESPACE}, database: ${SURREAL_DATABASE}`);

		isConnecting = false;
		return dbInstance;
	} catch (error) {
		isConnecting = false;
		dbInstance = null;
		console.error('[DB] Connection failed:', error);
		throw new Error(`Failed to connect to SurrealDB: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Close the database connection
 */
export async function closeDb(): Promise<void> {
	if (dbInstance) {
		try {
			await dbInstance.close();
			console.log('[DB] Connection closed');
			dbInstance = null;
		} catch (error) {
			console.error('[DB] Error closing connection:', error);
		}
	}
}

/**
 * Execute a query against SurrealDB
 * @param sql - SurrealQL query string
 * @param vars - Optional query variables
 * @returns Query result
 */
export async function query<T = unknown>(
	sql: string,
	vars?: Record<string, unknown>
): Promise<T> {
	try {
		const db = await getDb();
		const result = await db.query<[T]>(sql, vars);

		// SurrealDB returns results as an array, extract the first result
		if (Array.isArray(result) && result.length > 0) {
			return result[0];
		}

		return result as T;
	} catch (error) {
		console.error('[DB] Query failed:', { sql, error });
		throw new Error(
			`Database query failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Insert a record into SurrealDB
 * @param table - Table/collection name
 * @param data - Record data
 * @returns Created record
 */
export async function create<T>(
	table: string,
	data: Record<string, unknown>
): Promise<T> {
	try {
		const db = await getDb();
		const result = await db.create<T>(table, data);

		if (Array.isArray(result) && result.length > 0) {
			return result[0];
		}

		return result as T;
	} catch (error) {
		console.error('[DB] Create failed:', { table, error });
		throw new Error(
			`Failed to create record in ${table}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Update a record in SurrealDB
 * @param id - Record ID
 * @param data - Update data
 * @returns Updated record
 */
export async function update<T>(id: string, data: Record<string, unknown>): Promise<T> {
	try {
		const db = await getDb();
		const result = await db.update<T>(id, data);

		if (Array.isArray(result) && result.length > 0) {
			return result[0];
		}

		return result as T;
	} catch (error) {
		console.error('[DB] Update failed:', { id, error });
		throw new Error(
			`Failed to update record ${id}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Delete a record from SurrealDB
 * @param id - Record ID
 */
export async function remove(id: string): Promise<void> {
	try {
		const db = await getDb();
		await db.delete(id);
		console.log(`[DB] Deleted record: ${id}`);
	} catch (error) {
		console.error('[DB] Delete failed:', { id, error });
		throw new Error(
			`Failed to delete record ${id}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
