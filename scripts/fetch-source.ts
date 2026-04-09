import * as fs from 'fs';
import * as path from 'path';
import {
	fetchParsedSourceForIngest,
	VALID_INGEST_SOURCE_TYPES
} from './lib/fetchSourceCore.js';

const DATA_SOURCES_DIR = './data/sources';

/**
 * Usage: npx tsx --env-file=.env scripts/fetch-source.ts <url> <source-type>
 */
async function main() {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.error('Usage: npx tsx --env-file=.env scripts/fetch-source.ts <url> <source-type>');
		console.error(`Source types: ${VALID_INGEST_SOURCE_TYPES.join(', ')}`);
		process.exit(1);
	}

	const [url, sourceType] = args;

	if (!VALID_INGEST_SOURCE_TYPES.includes(sourceType as (typeof VALID_INGEST_SOURCE_TYPES)[number])) {
		console.error(`Invalid source type: ${sourceType}`);
		console.error(`Valid types: ${VALID_INGEST_SOURCE_TYPES.join(', ')}`);
		process.exit(1);
	}

	if (!fs.existsSync(DATA_SOURCES_DIR)) {
		fs.mkdirSync(DATA_SOURCES_DIR, { recursive: true });
		console.log(`[SETUP] Created directory: ${DATA_SOURCES_DIR}`);
	}

	try {
		const { text, titleSlug, meta, canonicalUrl } = await fetchParsedSourceForIngest(url, sourceType);

		const textPath = path.join(DATA_SOURCES_DIR, `${titleSlug}.txt`);
		fs.writeFileSync(textPath, text, 'utf-8');
		console.log(`[SAVE] Cleaned text: ${textPath}`);

		const metaPath = path.join(DATA_SOURCES_DIR, `${titleSlug}.meta.json`);
		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
		console.log(`[SAVE] Metadata: ${metaPath}`);

		console.log('\n[SUMMARY] SOURCE FETCHED SUCCESSFULLY');
		console.log(`Title: ${meta.title}`);
		if (meta.author.length > 0) {
			console.log(`Author(s): ${meta.author.join(', ')}`);
		}
		console.log(`Source Type: ${sourceType}`);
		console.log(`URL: ${canonicalUrl}`);
		console.log(`Word Count: ${meta.word_count.toLocaleString()}`);
		console.log(`Character Count: ${meta.char_count.toLocaleString()}`);
		console.log(`Estimated Tokens: ${meta.estimated_tokens.toLocaleString()}`);
		console.log(`Files saved to: data/sources/${titleSlug}.*`);

		if (meta.estimated_tokens > 100_000) {
			console.warn(
				'\n⚠️  WARNING: This source (~' +
					meta.estimated_tokens.toLocaleString() +
					' tokens) exceeds Claude\'s typical context window.'
			);
			console.warn('Consider breaking it into sections for ingestion.');
		}

		console.log('');
		process.exit(0);
	} catch (error) {
		console.error('\n[ERROR]', error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

void main();
