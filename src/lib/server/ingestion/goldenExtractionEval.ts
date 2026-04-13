import { createHash } from 'node:crypto';
import goldenExtractionEvalJson from './golden-extraction-eval.json';

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

/**
 * Golden eval URLs ship as a bundled JSON import so Vercel/serverless builds still resolve the file
 * (runtime `readFileSync` next to `import.meta.url` often points at a chunk path without the JSON asset).
 */
export function loadGoldenExtractionEval(): GoldenExtractionEvalFile {
	if (cached) return cached;
	cached = goldenExtractionEvalJson as GoldenExtractionEvalFile;
	return cached;
}

export function goldenExtractionEvalFingerprint(items: GoldenExtractionEvalItem[]): string {
	const lines = items
		.map((i) => `${(i.source_type ?? '').trim().toLowerCase()}|${i.url.trim().toLowerCase()}`)
		.sort();
	return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}
