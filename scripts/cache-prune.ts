/**
 * SOPHIA — Cache Pruning Script
 *
 * Removes expired cache entries from SurrealDB query_cache table
 * Entries older than 7 days (expires_at < now) are deleted
 *
 * Usage: npx tsx --env-file=.env scripts/cache-prune.ts [--dry-run]
 *   --dry-run: Show what would be deleted without actually deleting
 */

import { Surreal } from 'surrealdb';

// Read environment variables
const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

interface QueryCacheEntry {
	id?: string;
	query_hash: string;
	query_text: string;
	expires_at: string;
	created_at: string;
	hit_count: number;
}

async function pruneCacheTable(dryRun: boolean = false): Promise<void> {
	const db = new Surreal();

	try {
		console.log('[PRUNE] Connecting to SurrealDB...');
		await db.connect(SURREAL_URL);
		console.log(`[PRUNE] Connected to ${SURREAL_URL}`);

		// Sign in
		await db.signin({
			username: SURREAL_USER,
			password: SURREAL_PASS
		} as any);
		console.log('[PRUNE] Authenticated successfully');

		// Select namespace and database
		await db.use({
			namespace: SURREAL_NAMESPACE,
			database: SURREAL_DATABASE
		});
		console.log(`[PRUNE] Using namespace: ${SURREAL_NAMESPACE}, database: ${SURREAL_DATABASE}`);

		// Find expired entries
		console.log('\n[PRUNE] Scanning for expired cache entries...');
		const expiredEntries = await db.query<QueryCacheEntry[]>(
			`SELECT * FROM query_cache WHERE expires_at < time::now() ORDER BY expires_at DESC`
		);

		if (!Array.isArray(expiredEntries) || expiredEntries.length === 0) {
			console.log('[PRUNE] ✓ No expired entries found');
			await db.close();
			return;
		}

		console.log(`[PRUNE] Found ${expiredEntries.length} expired entries:\n`);

		// Display entries that will be deleted
		for (const entry of expiredEntries) {
			const expiresAt = new Date(entry.expires_at);
			const daysAgo = Math.floor(
				(new Date().getTime() - expiresAt.getTime()) / (1000 * 60 * 60 * 24)
			);
			console.log(
				`  • query_hash: ${entry.query_hash.substring(0, 8)}... ` +
								`(expired ${daysAgo}d ago, hits: ${entry.hit_count})`
			);
		}

		console.log(`\n[PRUNE] Total entries to delete: ${expiredEntries.length}`);

		// Perform deletion if not in dry-run mode
		if (dryRun) {
			console.log('[PRUNE] --dry-run mode: no entries were deleted\n');
		} else {
			console.log('[PRUNE] Deleting expired entries...\n');

			// Delete in batches to avoid overwhelming the database
			const batchSize = 100;
			let deleted = 0;

			for (let i = 0; i < expiredEntries.length; i += batchSize) {
				const batch = expiredEntries.slice(i, i + batchSize);
				const hashes = batch.map((e) => e.query_hash);

				// Use IN clause to delete multiple entries
				const result = await db.query(
					`DELETE query_cache WHERE query_hash IN $hashes`,
					{ hashes }
				);

				deleted += batch.length;
				console.log(`[PRUNE] Batch ${Math.ceil(deleted / batchSize)}: Deleted ${batch.length} entries`);
			}

			console.log(`\n[PRUNE] ✓ Successfully deleted ${deleted} expired entries\n`);
		}

		// Display remaining cache stats
		console.log('[PRUNE] Cache statistics:');
		const countResults = await db.query<[{ count: number }]>(
			`SELECT COUNT() as count FROM query_cache`
		);
		const totalCount = (Array.isArray(countResults) && countResults[0]?.count) || 0;
		console.log(`  • Total entries in cache: ${totalCount}`);

		const statsResults = await db.query<[{
			avg_hits: number;
			max_hits: number;
			min_hits: number;
		}]>(
			`SELECT
        math::avg(hit_count) as avg_hits,
        math::max(hit_count) as max_hits,
        math::min(hit_count) as min_hits
      FROM query_cache`
		);

		if (Array.isArray(statsResults) && statsResults[0]) {
			const stats = statsResults[0];
			console.log(
				`  • Average hits per entry: ${Number(stats.avg_hits || 0).toFixed(1)}`
			);
			console.log(`  • Max hits: ${stats.max_hits || 0}`);
			console.log(`  • Min hits: ${stats.min_hits || 0}`);
		}

		console.log('');

		await db.close();
		process.exit(0);
	} catch (error) {
		console.error(
			'[PRUNE] Error:',
			error instanceof Error ? error.message : String(error)
		);
		try {
			await db.close();
		} catch {
			// ignore
		}
		process.exit(1);
	}
}

// Parse command-line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

if (args.includes('--help') || args.includes('-h')) {
	console.log('SOPHIA — Cache Pruning Script');
	console.log('\nUsage: npx tsx --env-file=.env scripts/cache-prune.ts [options]\n');
	console.log('Options:');
	console.log('  --dry-run    Show what would be deleted without deleting');
	console.log('  --help       Show this help message\n');
	process.exit(0);
}

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║         SOPHIA — CACHE PRUNING                             ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

pruneCacheTable(isDryRun);
