/**
 * SOPHIA — Vector Backup Script
 * 
 * Exports all claim IDs and their current Voyage-generated 1024-dim embeddings
 * to a JSON file in data/backups/ for rollback purposes.
 * 
 * This backup is critical before migrating from Voyage AI (1024-dim) to 
 * Vertex AI text-embedding-005 (768-dim).
 * 
 * Usage: tsx --env-file=.env scripts/backup-vectors.ts
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

async function connect(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

async function fetchVectors(db: Surreal): Promise<ClaimVector[]> {
	console.log('[BACKUP] Fetching claim vectors...');
	const result = await db.query<ClaimVector[][]>(
		'SELECT id, embedding FROM claim WHERE embedding IS NOT NULL'
	);
	
	if (Array.isArray(result) && Array.isArray(result[0])) {
		return result[0];
	}
	return [];
}

async function main() {
	console.log('\n╔══════════════════════════════════════════════════════╗');
	console.log('║        SOPHIA — VECTOR BACKUP (Voyage AI)          ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');

	console.log(`[BACKUP] Connecting to ${SURREAL_URL}...`);
	const db = await connect();
	console.log('[BACKUP] Connected.\n');

	// Fetch all vectors
	const vectors = await fetchVectors(db);
	console.log(`[BACKUP] Retrieved ${vectors.length} claim vectors\n`);

	if (vectors.length === 0) {
		console.error('[BACKUP] ERROR: No vectors found. Nothing to backup.');
		process.exit(1);
	}

	const dimHistogram = new Map<number, number>();
	for (const v of vectors) {
		const d = v.embedding?.length ?? 0;
		dimHistogram.set(d, (dimHistogram.get(d) ?? 0) + 1);
	}
	const histObj = Object.fromEntries(
		[...dimHistogram.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => [String(k), c])
	);
	console.log('[BACKUP] Observed embedding dimensions (count per length):', histObj);

	// Validate embedding dimensions
	const firstDim = vectors[0].embedding?.length;
	console.log(`[BACKUP] First embedding dimension: ${firstDim}`);
	
	if (firstDim !== 1024) {
		console.warn(`[BACKUP] WARNING: Expected 1024 dimensions, found ${firstDim}`);
	}

	// Check all vectors have the same dimension
	const inconsistent = vectors.filter(v => v.embedding?.length !== firstDim);
	if (inconsistent.length > 0) {
		console.error(`[BACKUP] ERROR: Found ${inconsistent.length} vectors with inconsistent dimensions`);
		console.error(`[BACKUP] Expected: ${firstDim}, Found varying dimensions in:`);
		inconsistent.slice(0, 5).forEach(v => {
			console.error(`  - ${v.id}: ${v.embedding?.length} dims`);
		});
		process.exit(1);
	}

	// Create timestamped backup directory
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupDir = path.join(BACKUP_ROOT, timestamp);
	fs.mkdirSync(backupDir, { recursive: true });

	// Write backup file
	const backupFile = path.join(backupDir, 'vectors-voyage-1024.json');
	console.log(`[BACKUP] Writing to: ${backupFile}`);
	
	fs.writeFileSync(backupFile, JSON.stringify({
		timestamp,
		provider: 'voyage-ai',
		model: process.env.VOYAGE_MODEL || 'voyage-3-lite',
		dimension: firstDim,
		count: vectors.length,
		vectors
	}, null, 2));

	const stats = fs.statSync(backupFile);
	const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

	console.log(`[BACKUP] ✓ Backup complete`);
	console.log(`[BACKUP]   - Claims: ${vectors.length.toLocaleString()}`);
	console.log(`[BACKUP]   - Dimensions: ${firstDim}`);
	console.log(`[BACKUP]   - File size: ${sizeMB} MB`);
	console.log(`[BACKUP]   - Location: ${backupFile}\n`);

	await db.close();
}

main().catch((error) => {
	console.error('[BACKUP] FATAL ERROR:', error);
	process.exit(1);
});
