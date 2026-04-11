/**
 * Read-only Surreal inventory for claim.embedding (counts by dimension, optional per-source).
 * Usage: tsx --env-file=.env scripts/corpus-embedding-inventory.ts [--json]
 */

import { loadServerEnv } from '../src/lib/server/env.ts';
import { getEmbeddingDimensions } from '../src/lib/server/embeddings.ts';
import { getReembedCorpusInventory } from '../src/lib/server/ingestion/reembedCorpusInventory.ts';

loadServerEnv();

const json = process.argv.includes('--json');

async function main(): Promise<void> {
	const targetDim = getEmbeddingDimensions();
	const inventory = await getReembedCorpusInventory(targetDim);
	if (json) {
		console.log(JSON.stringify({ runtimeExpectedDim: targetDim, inventory }, null, 2));
		return;
	}
	console.log(`Runtime expected dimension: ${targetDim}`);
	console.log(`Claims with embedding NONE: ${inventory.noneCount}`);
	console.log(`Claims needing work (NONE or len != ${targetDim}): ${inventory.needsWorkCount}`);
	console.log('\nBy vector length:');
	for (const b of inventory.dimBuckets) {
		console.log(`  ${b.dim ?? 'unknown'} dims: ${b.count}`);
	}
	if (inventory.perSourceNonTarget.length > 0) {
		console.log('\nTop sources with non-target embeddings:');
		for (const s of inventory.perSourceNonTarget.slice(0, 25)) {
			console.log(`  ${s.sourceId}: ${s.count}`);
		}
	}
}

void main().catch((e) => {
	console.error(e);
	process.exit(1);
});
