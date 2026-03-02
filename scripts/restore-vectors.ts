/**
 * SOPHIA — Vector Restoration Script (Rollback)
 * 
 * Restores Voyage AI vectors (1024-dim) from backup in case the Vertex AI
 * migration produces unsatisfactory retrieval results.
 * 
 * Process:
 * 1. Load backup file (vectors-voyage-1024.json)
 * 2. Update SurrealDB vector index dimension (768 → 1024)
 * 3. Restore original Voyage vectors to each claim
 * 
 * Usage: 
 *   tsx --env-file=.env scripts/restore-vectors.ts
 *   tsx --env-file=.env scripts/restore-vectors.ts --backup-file data/backups/2026-03-02T10-30-00-000Z/vectors-voyage-1024.json
 */

import { Surreal } from 'surrealdb';
import * as fs from 'fs';
import * as path from 'path';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const BACKUP_ROOT = path.join(process.cwd(), 'data', 'backups');

interface ClaimVector {
	id: string;
	embedding: number[];
}

interface VectorBackup {
	timestamp: string;
	provider: string;
	model: string;
	dimension: number;
	count: number;
	vectors: ClaimVector[];
}

async function connect(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

function findLatestBackup(): string | null {
	if (!fs.existsSync(BACKUP_ROOT)) {
		return null;
	}

	const entries = fs
		.readdirSync(BACKUP_ROOT, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort()
		.reverse(); // Most recent first

	for (const dir of entries) {
		const vectorFile = path.join(BACKUP_ROOT, dir, 'vectors-voyage-1024.json');
		if (fs.existsSync(vectorFile)) {
			return vectorFile;
		}
	}

	return null;
}

function loadBackup(backupFile: string): VectorBackup {
	console.log(`[RESTORE] Loading backup from: ${backupFile}`);
	const content = fs.readFileSync(backupFile, 'utf-8');
	return JSON.parse(content);
}

async function updateVectorIndexDimension(db: Surreal, dimension: number): Promise<void> {
	console.log(`[RESTORE] Updating vector index dimension → ${dimension}...`);
	
	// Remove current index
	await db.query('REMOVE INDEX claim_embedding ON claim');
	console.log(`[RESTORE]   - Removed existing index`);
	
	// Create new index with specified dimension
	await db.query(`DEFINE INDEX claim_embedding ON claim FIELDS embedding MTREE DIMENSION ${dimension}`);
	console.log(`[RESTORE]   - Created ${dimension}-dim index`);
}

async function restoreClaimEmbedding(db: Surreal, claimId: string, embedding: number[]): Promise<void> {
	await db.query(
		`UPDATE ${claimId} SET embedding = $embedding`,
		{ embedding }
	);
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
	const args = process.argv.slice(2);
	const backupFileArg = args.find(arg => arg.startsWith('--backup-file='));
	
	let backupFile: string | null;
	
	if (backupFileArg) {
		backupFile = backupFileArg.split('=')[1];
		if (!fs.existsSync(backupFile)) {
			console.error(`[RESTORE] ERROR: Backup file not found: ${backupFile}`);
			process.exit(1);
		}
	} else {
		backupFile = findLatestBackup();
	}

	console.log('\n╔══════════════════════════════════════════════════════╗');
	console.log('║      SOPHIA — VECTOR RESTORATION (Rollback)        ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');

	// Step 1: Verify backup exists
	console.log('[RESTORE] Step 1: Verifying backup...');
	
	if (!backupFile) {
		console.error('[RESTORE] FATAL: No backup found!');
		console.error('[RESTORE] Specify backup file with: --backup-file=path/to/vectors-voyage-1024.json');
		process.exit(1);
	}
	
	console.log(`[RESTORE] ✓ Using backup: ${backupFile}\n`);

	// Step 2: Load backup
	console.log('[RESTORE] Step 2: Loading backup data...');
	const backup = loadBackup(backupFile);
	
	console.log(`[RESTORE] Backup metadata:`);
	console.log(`  - Timestamp: ${backup.timestamp}`);
	console.log(`  - Provider: ${backup.provider}`);
	console.log(`  - Model: ${backup.model}`);
	console.log(`  - Dimension: ${backup.dimension}`);
	console.log(`  - Vector count: ${backup.count.toLocaleString()}\n`);

	if (backup.dimension !== 1024) {
		console.error(`[RESTORE] ERROR: Expected 1024-dim backup, found ${backup.dimension}-dim`);
		process.exit(1);
	}

	if (backup.vectors.length !== backup.count) {
		console.error(`[RESTORE] ERROR: Backup metadata mismatch (expected ${backup.count}, got ${backup.vectors.length} vectors)`);
		process.exit(1);
	}

	// Step 3: Connect to database
	console.log(`[RESTORE] Step 3: Connecting to ${SURREAL_URL}...`);
	const db = await connect();
	console.log('[RESTORE] ✓ Connected\n');

	// Step 4: Update vector index dimension back to 1024
	console.log('[RESTORE] Step 4: Updating vector index (768 → 1024)...');
	await updateVectorIndexDimension(db, 1024);
	console.log('[RESTORE] ✓ Vector index restored\n');

	// Step 5: Restore vectors
	console.log('[RESTORE] Step 5: Restoring vectors...');
	console.log(`[RESTORE] Total vectors to restore: ${backup.vectors.length}\n`);

	let restored = 0;
	let failed = 0;
	const failedIds: string[] = [];

	for (let i = 0; i < backup.vectors.length; i++) {
		const { id, embedding } = backup.vectors[i];

		try {
			await restoreClaimEmbedding(db, id, embedding);
			restored++;

			// Progress update every 100 claims
			if ((i + 1) % 100 === 0) {
				const percentComplete = (((i + 1) / backup.vectors.length) * 100).toFixed(1);
				console.log(`[RESTORE] Progress: ${i + 1}/${backup.vectors.length} (${percentComplete}%)`);
			}
		} catch (error) {
			console.error(`[RESTORE] Failed to restore ${id}:`, error);
			failed++;
			failedIds.push(id);
		}
	}

	// Final summary
	console.log('\n[RESTORE] === RESTORATION COMPLETE ===');
	console.log(`Total vectors: ${backup.vectors.length.toLocaleString()}`);
	console.log(`Successfully restored: ${restored.toLocaleString()}`);
	console.log(`Failed: ${failed}`);
	
	if (failedIds.length > 0) {
		console.log('\nFailed claim IDs:');
		failedIds.forEach(id => console.log(`  - ${id}`));
	}

	// Verify a sample
	console.log('\n[RESTORE] Verifying sample claims...');
	const sampleIds = backup.vectors.slice(0, 3).map(v => v.id);
	for (const id of sampleIds) {
		const result = await db.query<{ embedding: number[] }[][]>(
			`SELECT embedding FROM ${id}`
		);
		const embedding = result[0]?.[0]?.embedding;
		console.log(`  - ${id}: ${embedding?.length || 0} dimensions`);
		
		if (embedding && embedding.length !== 1024) {
			console.error(`[RESTORE] ERROR: Expected 1024 dimensions, got ${embedding.length}`);
		}
	}

	console.log('\n[RESTORE] ✓ Rollback complete! Voyage AI 1024-dim vectors restored.\n');
	console.log('[RESTORE] NOTE: You will need to revert embeddings.ts to use Voyage AI client.');
	
	await db.close();
}

main().catch((error) => {
	console.error('[RESTORE] FATAL ERROR:', error);
	process.exit(1);
});
