import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkDatabaseHealth, getDatabaseRuntimeConfig, query } from '$lib/server/db';

const RELATION_TABLES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'defines',
	'qualifies',
	'refines',
	'exemplifies',
	'part_of'
];

async function countTable(table: string): Promise<number> {
	try {
		const result = await query<{ count: number }[]>(
			`SELECT count() AS count FROM ${table} GROUP ALL`
		);
		return Array.isArray(result) ? (result[0]?.count ?? 0) : 0;
	} catch {
		return 0;
	}
}

export const GET: RequestHandler = async (event) => {
	const runtime = getDatabaseRuntimeConfig();
	const includeDb = event.url.searchParams.get('details') === 'true';

	// Fast health check for Cloud Run startup probes.
	// Keep this route independent of database availability by default.
	let dbStatus: {
		status: 'connected' | 'disconnected';
		latency_ms?: number;
		error?: string;
		runtime: {
			mode: 'http-sql';
			url: string;
			namespace: string;
			database: string;
			timeoutMs: number;
			maxRetries: number;
		};
		counts?: {
			sources: number;
			claims: number;
			arguments: number;
			relations: number;
		};
	};

	if (!includeDb) {
		dbStatus = {
			status: 'connected',
			runtime
		};
	} else {
		try {
			const heartbeat = await checkDatabaseHealth();
			if (!heartbeat.ok) {
				throw new Error(heartbeat.error || 'Database health probe failed');
			}

			// If ?details=true, include expensive table counts
			const [sources, claims, args, ...relationCounts] = await Promise.all([
				countTable('source'),
				countTable('claim'),
				countTable('argument'),
				...RELATION_TABLES.map((t) => countTable(t))
			]);

			const relations = relationCounts.reduce((sum, n) => sum + n, 0);

			dbStatus = {
				status: 'connected',
				latency_ms: heartbeat.latencyMs,
				runtime,
				counts: { sources, claims, arguments: args, relations }
			};
		} catch (err) {
			dbStatus = {
				status: 'disconnected',
				runtime,
				error: err instanceof Error ? err.message : String(err)
			};
		}
	}

	const healthy = !includeDb || dbStatus.status === 'connected';

	return json(
		{
			status: healthy ? 'healthy' : 'degraded',
			readiness: healthy ? 'ready' : 'degraded',
			app: { status: 'up' },
			database: dbStatus,
			timestamp: new Date().toISOString()
		},
		{ status: 200 }
	);
};
