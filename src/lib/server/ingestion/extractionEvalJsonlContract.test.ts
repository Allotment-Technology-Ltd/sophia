import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	countPassageOpenTagsInInput,
	parseExtractionEvalJsonlLine,
	validateExtractionEvalJsonlRow
} from './extractionEvalJsonlContract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../../../');
const fixturesDir = join(repoRoot, 'data/phase1-training-export/fixtures');

function loadJsonlLines(rel: string): string[] {
	const p = join(fixturesDir, rel);
	const body = readFileSync(p, 'utf8');
	return body.split('\n').map((l) => l.trim()).filter(Boolean);
}

describe('extraction eval JSONL fixtures (offline regression + batch stress)', () => {
	it('prod regression pack: every line parses and validates labels', () => {
		const lines = loadJsonlLines('eval_prod_regression_pack.jsonl');
		expect(lines.length).toBeGreaterThanOrEqual(2);
		for (const line of lines) {
			const row = parseExtractionEvalJsonlLine(line);
			expect(row).not.toBeNull();
			const v = validateExtractionEvalJsonlRow(row!);
			expect(v, JSON.stringify(v)).toEqual({ ok: true });
			expect(row!.source_url ?? '').toMatch(/^https:\/\/regression\.example\.invalid\//);
		}
	});

	it('batch format stress: multi-passage input + valid gold label', () => {
		const lines = loadJsonlLines('eval_batch_format_stress.jsonl');
		expect(lines).toHaveLength(1);
		const row = parseExtractionEvalJsonlLine(lines[0]!);
		expect(row).not.toBeNull();
		const v = validateExtractionEvalJsonlRow(row!);
		expect(v).toEqual({ ok: true });
		const n = countPassageOpenTagsInInput((row!.input as string) ?? '');
		expect(n).toBeGreaterThanOrEqual(3);
	});
});
