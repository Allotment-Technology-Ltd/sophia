import type { PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { query } from '$lib/server/db';
import { adminDb } from '$lib/server/firebase-admin';
import { createApiKey } from '$lib/server/apiAuth';
import { Timestamp } from 'firebase-admin/firestore';
import type { Actions } from './$types';

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

interface ApiKeyItem {
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

export const load: PageServerLoad = async ({ locals }) => {
	// Require authentication
	if (!locals.user) {
		throw redirect(302, '/auth');
	}

	// Check admin whitelist
	const adminUids = process.env.ADMIN_UIDS?.split(',').map(uid => uid.trim()) ?? [];
	if (!adminUids.includes(locals.user.uid)) {
		throw error(403, 'Forbidden: Admin access required');
	}

	try {
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

		const apiKeySnapshot = await adminDb.collection('api_keys').orderBy('created_at', 'desc').limit(50).get();
		const apiKeys: ApiKeyItem[] = apiKeySnapshot.docs.map((doc) => {
			const data = doc.data();
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
			domainDistribution: domainDist || [],
			relationDistribution,
			averageValidationScore: validationResult?.avg || null,
			recentIngestions: recentIngestions || [],
			apiKeys
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
			apiKeys: [],
			error: error instanceof Error ? error.message : 'Failed to load dashboard data'
		};
	}
};

export const actions: Actions = {
	generateKey: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, '/auth');
		}

		const adminUids = process.env.ADMIN_UIDS?.split(',').map(uid => uid.trim()) ?? [];
		if (!adminUids.includes(locals.user.uid)) {
			throw error(403, 'Forbidden: Admin access required');
		}

		const formData = await request.formData();
		const name = String(formData.get('name') ?? 'Admin Key').trim() || 'Admin Key';
		const ownerUid = String(formData.get('owner_uid') ?? locals.user.uid).trim() || locals.user.uid;
		const dailyQuotaRaw = Number(formData.get('daily_quota') ?? 100);
		const dailyQuota = Number.isFinite(dailyQuotaRaw) ? Math.max(1, Math.floor(dailyQuotaRaw)) : 100;

		const { rawKey, keyId, keyHash, prefix } = createApiKey();
		const now = Timestamp.now();

		await adminDb.collection('api_keys').doc(keyId).set({
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
			keyId
		};
	}
};
