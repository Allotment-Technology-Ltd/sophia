import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';

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

export const GET: RequestHandler = async () => {
	let dbStatus: {
		status: 'connected' | 'disconnected';
		error?: string;
		counts?: {
			sources: number;
			claims: number;
			arguments: number;
			relations: number;
		};
	};

	try {
		const [sources, claims, args, ...relationCounts] = await Promise.all([
			countTable('source'),
			countTable('claim'),
			countTable('argument'),
			...RELATION_TABLES.map((t) => countTable(t))
		]);

		const relations = relationCounts.reduce((sum, n) => sum + n, 0);

		dbStatus = {
			status: 'connected',
			counts: { sources, claims, arguments: args, relations }
		};
	} catch (err) {
		dbStatus = {
			status: 'disconnected',
			error: err instanceof Error ? err.message : String(err)
		};
	}

	const healthy = dbStatus.status === 'connected';

	return json(
		{
			status: healthy ? 'healthy' : 'degraded',
			app: { status: 'up' },
			database: dbStatus,
			timestamp: new Date().toISOString()
		},
		{ status: 200 }
	);
};
