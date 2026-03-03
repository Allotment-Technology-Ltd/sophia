import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkDatabaseHealth, getDatabaseRuntimeConfig, query } from '$lib/server/db';

const RELATION_TABLES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'refines',
	'exemplifies',
	'part_of'
];

async function countTable(table: string): Promise<number> {
	const result = await query<{ count: number }[]>(
		`SELECT count() AS count FROM ${table} GROUP ALL`
	);
	return Array.isArray(result) ? (result[0]?.count ?? 0) : 0;
}

export const GET: RequestHandler = async (event) => {
	const runtime = getDatabaseRuntimeConfig();
	
	// Fast health check: just a quick heartbeat to the database
	// Used by Cloud Run startup probe (must respond quickly, < 10s)
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

	try {
		const heartbeat = await checkDatabaseHealth();
		if (!heartbeat.ok) {
			throw new Error(heartbeat.error || 'Database health probe failed');
		}

		// If ?details=true, include expensive table counts
		// Otherwise return fast heartbeat only
		if (event.url.searchParams.get('details') === 'true') {
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
		} else {
			// Fast response: just latency from heartbeat
			dbStatus = {
				status: 'connected',
				latency_ms: heartbeat.latencyMs,
				runtime
			};
		}
	} catch (err) {
		dbStatus = {
			status: 'disconnected',
			runtime,
			error: err instanceof Error ? err.message : String(err)
		};
	}

	const healthy = dbStatus.status === 'connected';

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
