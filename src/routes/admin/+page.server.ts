import type { PageServerLoad } from './$types';
import { getDb, query } from '$lib/server/db';

interface Source {
	id: string;
	title: string;
	source_type: string;
	claim_count: number | null;
	status: string;
	ingested_at: string;
}

interface DomainCount {
	domain: string;
	count: number;
}

interface RelationCount {
	type: string;
	count: number;
}

export const load: PageServerLoad = async () => {
	try {
		// Connect to database
		await getDb();

		// Get total counts
		const [sourceCount] = await query<{ count: number }[]>(
			'SELECT count() AS count FROM source GROUP ALL'
		);

		const [claimCount] = await query<{ count: number }[]>(
			'SELECT count() AS count FROM claim GROUP ALL'
		);

		const [argumentCount] = await query<{ count: number }[]>(
			'SELECT count() AS count FROM argument GROUP ALL'
		);

		// Count relations across all relation tables
		const relationTables = [
			'supports',
			'contradicts',
			'depends_on',
			'responds_to',
			'refines',
			'exemplifies'
		];

		let totalRelations = 0;
		const relationDistribution: RelationCount[] = [];

		for (const table of relationTables) {
			try {
				const [result] = await query<{ count: number }[]>(
					`SELECT count() AS count FROM ${table} GROUP ALL`
				);
				const count = result?.count || 0;
				totalRelations += count;
				if (count > 0) {
					relationDistribution.push({ type: table, count });
				}
			} catch {
				// Table might be empty or not exist yet
				relationDistribution.push({ type: table, count: 0 });
			}
		}

		// Get sources list
		const sources = await query<Source[]>(`
			SELECT 
				id,
				title,
				source_type,
				claim_count,
				status,
				ingested_at
			FROM source
			ORDER BY ingested_at DESC
		`);

		// Get domain distribution
		const domainDist = await query<DomainCount[]>(`
			SELECT domain, count() AS count
			FROM claim
			GROUP BY domain
		`);

		// Get average validation score
		const [validationResult] = await query<{ avg: number | null }[]>(`
			SELECT math::mean(validation_score) AS avg
			FROM claim
			WHERE validation_score IS NOT NONE
			GROUP ALL
		`);

		// Get recent ingestions (last 10)
		const recentIngestions = await query<Source[]>(`
			SELECT 
				id,
				title,
				source_type,
				claim_count,
				status,
				ingested_at
			FROM source
			ORDER BY ingested_at DESC
			LIMIT 10
		`);

		return {
			stats: {
				sources: sourceCount?.count || 0,
				claims: claimCount?.count || 0,
				arguments: argumentCount?.count || 0,
				relations: totalRelations
			},
			sources: sources || [],
			domainDistribution: domainDist || [],
			relationDistribution,
			averageValidationScore: validationResult?.avg || null,
			recentIngestions: recentIngestions || []
		};
	} catch (error) {
		console.error('[ADMIN] Error loading dashboard data:', error);
		// Return empty data rather than failing the page load
		return {
			stats: {
				sources: 0,
				claims: 0,
				arguments: 0,
				relations: 0
			},
			sources: [],
			domainDistribution: [],
			relationDistribution: [],
			averageValidationScore: null,
			recentIngestions: [],
			error: error instanceof Error ? error.message : 'Failed to load dashboard data'
		};
	}
};
