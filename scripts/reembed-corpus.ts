/**
 * SOPHIA — Corpus Re-Embedding Script
 * 
 * Migrates from Voyage AI (1024-dim) to Vertex AI text-embedding-005 (768-dim).
 * 
 * Process:
 * 1. Verify backup exists
 * 2. Read all claims from SurrealDB
 * 3. Embed each claim via Vertex AI text-embedding-005
 * 4. Update SurrealDB vector index dimension (1024 → 768)
 * 5. Write new vectors back to database
 * 
 * CRITICAL: Run scripts/backup-vectors.ts FIRST before running this script.
 * 
 * Usage: tsx --env-file=.env scripts/reembed-corpus.ts [--batch-size 100] [--start-index 0]
 */

import { Surreal } from 'surrealdb';
import * as fs from 'fs';
import * as path from 'path';
import { embedTexts } from '../src/lib/server/embeddings';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const BACKUP_ROOT = path.join(process.cwd(), 'data', 'backups');
const DEFAULT_BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES_MS = 1000; // 1 second delay to avoid rate limits

interface Claim {
	id: string;
	text: string;
	embedding?: number[];
}

interface ReembedProgress {
	startTime: string;
	totalClaims: number;
	processedClaims: number;
	failedClaims: string[];
	lastProcessedIndex: number;
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

async function fetchClaims(db: Surreal): Promise<Claim[]> {
	console.log('[REEMBED] Fetching all claims...');
	const result = await db.query<Claim[][]>(
		'SELECT id, text, embedding FROM claim ORDER BY id'
	);
	
	if (Array.isArray(result) && Array.isArray(result[0])) {
		return result[0];
	}
	return [];
}

async function updateVectorIndexDimension(db: Surreal): Promise<void> {
	console.log('[REEMBED] Updating vector index dimension (1024 → 768)...');
	
	// Step 1: Try to remove old index (ignore if doesn't exist)
	try {
		await db.query('REMOVE INDEX claim_embedding ON claim');
		console.log('[REEMBED]   - Removed old index');
	} catch (error) {
		console.log('[REEMBED]   - No existing index to remove (ok)');
	}
	
	// Step 2: Clear all existing embeddings (required before creating new dimension index)
	console.log('[REEMBED]   - Clearing existing embeddings...');
	const clearResult = await db.query('UPDATE claim SET embedding = NONE WHERE embedding IS NOT NULL');
	console.log('[REEMBED]   - Embeddings cleared');
	
	// Step 3: Create new 768-dim index
	await db.query('DEFINE INDEX claim_embedding ON claim FIELDS embedding MTREE DIMENSION 768');
	console.log('[REEMBED]   - Created new 768-dim index');
}

async function updateClaimEmbedding(db: Surreal, claimId: string, embedding: number[]): Promise<void> {
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
	const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
	const startIndexArg = args.find(arg => arg.startsWith('--start-index='));
	
	const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : DEFAULT_BATCH_SIZE;
	const startIndex = startIndexArg ? parseInt(startIndexArg.split('=')[1]) : 0;

	console.log('\n╔══════════════════════════════════════════════════════╗');
	console.log('║     SOPHIA — CORPUS RE-EMBEDDING (Vertex AI)       ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');

	// Step 1: Verify backup exists
	console.log('[REEMBED] Step 1: Verifying backup exists...');
	const backupFile = findLatestBackup();
	
	if (!backupFile) {
		console.error('[REEMBED] FATAL: No backup found!');
		console.error('[REEMBED] Run scripts/backup-vectors.ts FIRST before re-embedding.');
		process.exit(1);
	}
	
	console.log(`[REEMBED] ✓ Backup found: ${backupFile}\n`);

	// Step 2: Connect to database
	console.log(`[REEMBED] Step 2: Connecting to ${SURREAL_URL}...`);
	const db = await connect();
	console.log('[REEMBED] ✓ Connected\n');

	// Step 3: Fetch all claims
	console.log('[REEMBED] Step 3: Fetching claims...');
	const claims = await fetchClaims(db);
	console.log(`[REEMBED] ✓ Retrieved ${claims.length} claims\n`);

	if (claims.length === 0) {
		console.error('[REEMBED] ERROR: No claims found in database.');
		process.exit(1);
	}

	// Step 4: Update vector index dimension
	console.log('[REEMBED] Step 4: Updating vector index...');
	await updateVectorIndexDimension(db);
	console.log('[REEMBED] ✓ Vector index updated\n');

	// Step 5: Re-embed in batches
	console.log('[REEMBED] Step 5: Re-embedding claims...');
	console.log(`[REEMBED] Batch size: ${batchSize}`);
	console.log(`[REEMBED] Starting from index: ${startIndex}\n`);

	const progress: ReembedProgress = {
		startTime: new Date().toISOString(),
		totalClaims: claims.length,
		processedClaims: 0,
		failedClaims: [],
		lastProcessedIndex: startIndex
	};

	const claimsToProcess = claims.slice(startIndex);
	const totalBatches = Math.ceil(claimsToProcess.length / batchSize);

	for (let i = 0; i < claimsToProcess.length; i += batchSize) {
		const batch = claimsToProcess.slice(i, i + batchSize);
		const batchNum = Math.floor(i / batchSize) + 1;
		const globalIndex = startIndex + i;

		console.log(`[REEMBED] Batch ${batchNum}/${totalBatches} (claims ${globalIndex}-${globalIndex + batch.length - 1})`);

		try {
			// Extract texts for embedding
			const texts = batch.map(c => c.text);
			
			// Embed batch via Vertex AI
			const embeddings = await embedTexts(texts);
			
			// Update database
			for (let j = 0; j < batch.length; j++) {
				const claim = batch[j];
				const embedding = embeddings[j];
				
				try {
					await updateClaimEmbedding(db, claim.id, embedding);
					progress.processedClaims++;
				} catch (error) {
					console.error(`[REEMBED] Failed to update ${claim.id}:`, error);
					progress.failedClaims.push(claim.id);
				}
			}

			progress.lastProcessedIndex = globalIndex + batch.length;

			const percentComplete = ((progress.processedClaims / claims.length) * 100).toFixed(1);
			console.log(`[REEMBED] ✓ Batch ${batchNum} complete (${percentComplete}% total)\n`);

			// Delay between batches to respect rate limits
			if (i + batchSize < claimsToProcess.length) {
				await delay(DELAY_BETWEEN_BATCHES_MS);
			}

		} catch (error) {
			console.error(`[REEMBED] ERROR in batch ${batchNum}:`, error);
			console.error(`[REEMBED] You can resume from index ${globalIndex} using:`);
			console.error(`[REEMBED]   tsx --env-file=.env scripts/reembed-corpus.ts --start-index=${globalIndex}`);
			process.exit(1);
		}
	}

	// Final summary
	console.log('\n[REEMBED] === RE-EMBEDDING COMPLETE ===');
	console.log(`Total claims: ${progress.totalClaims.toLocaleString()}`);
	console.log(`Successfully processed: ${progress.processedClaims.toLocaleString()}`);
	console.log(`Failed: ${progress.failedClaims.length}`);
	
	if (progress.failedClaims.length > 0) {
		console.log('\nFailed claim IDs:');
		progress.failedClaims.forEach(id => console.log(`  - ${id}`));
	}

	// Verify a sample
	console.log('\n[REEMBED] Verifying sample claims...');
	const sampleIds = claims.slice(0, 3).map(c => c.id);
	for (const id of sampleIds) {
		const result = await db.query<{ embedding: number[] }[][]>(
			`SELECT embedding FROM ${id}`
		);
		const embedding = result[0]?.[0]?.embedding;
		console.log(`  - ${id}: ${embedding?.length || 0} dimensions`);
		
		if (embedding && embedding.length !== 768) {
			console.error(`[REEMBED] ERROR: Expected 768 dimensions, got ${embedding.length}`);
		}
	}

	console.log('\n[REEMBED] ✓ All done! New 768-dim Vertex AI embeddings are live.\n');
	
	await db.close();
}

main().catch((error) => {
	console.error('[REEMBED] FATAL ERROR:', error);
	process.exit(1);
});
