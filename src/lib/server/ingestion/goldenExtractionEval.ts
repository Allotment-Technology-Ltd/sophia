import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type GoldenExtractionEvalItem = {
	url: string;
	source_type?: string;
	why?: string;
};

export type GoldenExtractionEvalFile = {
	version: number;
	description?: string;
	default_source_type?: string;
	items: GoldenExtractionEvalItem[];
	web_article_placeholders?: Record<string, unknown>;
};

let cached: GoldenExtractionEvalFile | null = null;

export function loadGoldenExtractionEval(): GoldenExtractionEvalFile {
	if (cached) return cached;
	const dir = dirname(fileURLToPath(import.meta.url));
	const raw = readFileSync(join(dir, 'golden-extraction-eval.json'), 'utf8');
	cached = JSON.parse(raw) as GoldenExtractionEvalFile;
	return cached;
}

export function goldenExtractionEvalFingerprint(items: GoldenExtractionEvalItem[]): string {
	const lines = items
		.map((i) => `${(i.source_type ?? '').trim().toLowerCase()}|${i.url.trim().toLowerCase()}`)
		.sort();
	return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}
