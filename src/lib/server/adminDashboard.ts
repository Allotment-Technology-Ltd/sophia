import { Timestamp } from '$lib/server/fsCompat';
import { query } from '$lib/server/db';
import { sophiaDocumentsDb } from '$lib/server/sophiaDocumentsDb';
import { createApiKey } from '$lib/server/apiAuth';
import type { AdminActor } from '$lib/server/adminAccess';

export interface Source {
	id: string;
	title: string;
	source_type: string;
	claim_count: number | null;
	status: string;
	ingested_at: string;
}

export interface DomainCount {
	domain: string;
	count: number;
}

export interface RelationCount {
	type: string;
	count: number;
}

export interface ApiKeyItem {
	key_id: string;
	name: string;
	owner_uid: string;
	key_prefix: string;
	active: boolean;
	usage_count: number;
	created_at: string | null;
	last_used_at: string | null;
	daily_quota: number;
}

export interface AdminDashboardData {
	stats: {
		sources: number;
		claims: number;
		arguments: number;
		relations: number;
	};
	sources: Source[];
	domainDistribution: DomainCount[];
	relationDistribution: RelationCount[];
	averageValidationScore: number | null;
	recentIngestions: Source[];
	apiKeys: ApiKeyItem[];
	error?: string;
}

export interface CreateAdminApiKeyInput {
	name?: string;
	owner_uid?: string;
	daily_quota?: number;
}

const RELATION_TABLES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'defines',
	'qualifies',
	'refines',
	'exemplifies'
] as const;

function emptyDashboard(error?: string): AdminDashboardData {
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
		apiKeys: [],
		...(error ? { error } : {})
	};
}

export async function loadAdminDashboardData(): Promise<AdminDashboardData> {
	try {
		const [sourceCount] = await query<{ count: number }[]>(
			'SELECT count() AS count FROM source GROUP ALL'
		);
		const [claimCount] = await query<{ count: number }[]>(
			'SELECT count() AS count FROM claim GROUP ALL'
		);
		const [argumentCount] = await query<{ count: number }[]>(
			'SELECT count() AS count FROM argument GROUP ALL'
		);

		let totalRelations = 0;
		const relationDistribution: RelationCount[] = [];
		for (const table of RELATION_TABLES) {
			try {
				const [result] = await query<{ count: number }[]>(
					`SELECT count() AS count FROM ${table} GROUP ALL`
				);
				const count = result?.count || 0;
				totalRelations += count;
				relationDistribution.push({ type: table, count });
			} catch {
				relationDistribution.push({ type: table, count: 0 });
			}
		}

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

		const domainDistribution = await query<DomainCount[]>(`
			SELECT domain, count() AS count
			FROM claim
			GROUP BY domain
		`);

		const [validationResult] = await query<{ avg: number | null }[]>(`
			SELECT math::mean(validation_score) AS avg
			FROM claim
			WHERE validation_score IS NOT NONE
			GROUP ALL
		`);

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

		const apiKeySnapshot = await sophiaDocumentsDb
			.collection('api_keys')
			.orderBy('created_at', 'desc')
			.limit(50)
			.get();
		const apiKeys: ApiKeyItem[] = apiKeySnapshot.docs.map((doc) => {
			const data = doc.data() ?? {};
			return {
				key_id: doc.id,
				name: data.name ?? 'API key',
				owner_uid: data.owner_uid ?? 'unknown',
				key_prefix: data.key_prefix ?? 'sk-sophia-***',
				active: Boolean(data.active),
				usage_count: data.usage_count ?? 0,
				created_at: data.created_at?.toDate?.()?.toISOString() ?? null,
				last_used_at: data.last_used_at?.toDate?.()?.toISOString() ?? null,
				daily_quota: data.rate_limit?.daily_quota ?? 100
			};
		});

		return {
			stats: {
				sources: sourceCount?.count || 0,
				claims: claimCount?.count || 0,
				arguments: argumentCount?.count || 0,
				relations: totalRelations
			},
			sources: sources || [],
			domainDistribution: domainDistribution || [],
			relationDistribution,
			averageValidationScore: validationResult?.avg || null,
			recentIngestions: recentIngestions || [],
			apiKeys
		};
	} catch (error) {
		console.error('[ADMIN] Error loading dashboard data:', error);
		return emptyDashboard(error instanceof Error ? error.message : 'Failed to load dashboard data');
	}
}

export async function createAdminApiKey(
	actor: AdminActor,
	input: CreateAdminApiKeyInput
): Promise<{
	success: true;
	generatedKey: string;
	keyId: string;
	owner_uid: string;
	name: string;
	daily_quota: number;
	created_at: string;
}> {
	const name = String(input.name ?? 'Admin Key').trim() || 'Admin Key';
	const ownerUid = String(input.owner_uid ?? actor.uid).trim() || actor.uid;
	const dailyQuotaRaw = Number(input.daily_quota ?? 100);
	const dailyQuota = Number.isFinite(dailyQuotaRaw)
		? Math.max(1, Math.floor(dailyQuotaRaw))
		: 100;

	const { rawKey, keyId, keyHash, prefix } = createApiKey();
	const now = Timestamp.now();

	await sophiaDocumentsDb.collection('api_keys').doc(keyId).set({
		key_hash: keyHash,
		owner_uid: ownerUid,
		name,
		key_prefix: prefix,
		created_at: now,
		active: true,
		usage_count: 0,
		daily_count: 0,
		daily_reset_at: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
		rate_limit: {
			daily_quota: dailyQuota
		}
	});

	return {
		success: true,
		generatedKey: rawKey,
		keyId,
		owner_uid: ownerUid,
		name,
		daily_quota: dailyQuota,
		created_at: now.toDate().toISOString()
	};
}
