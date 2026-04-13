/**
 * Phase 1 handoff manifest: frozen golden URLs plus optional Neon enrichment (last `done` run per URL).
 *
 *   pnpm ops:phase1-export-ingestion-manifest
 *   pnpm exec tsx scripts/export-phase1-ingestion-manifest.ts -- --out=data/phase1-ingestion-manifest.json
 *
 * Requires DATABASE_URL for Neon enrichment (optional — without it, only golden metadata is written).
 */

import { writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRuns } from '../src/lib/server/db/schema.ts';
import { canonicalizeSourceUrl } from '../src/lib/server/sourceIdentity.ts';
import {
	goldenExtractionEvalFingerprint,
	loadGoldenExtractionEval
} from '../src/lib/server/ingestion/goldenExtractionEval.ts';

loadServerEnv();

function parseOut(): string {
	const a = process.argv.find((x) => x.startsWith('--out='));
	return a?.slice('--out='.length)?.trim() || 'data/phase1-ingestion-manifest.json';
}

async function main() {
	const golden = loadGoldenExtractionEval();
	const fp = goldenExtractionEvalFingerprint(golden.items);
	const def = (golden.default_source_type ?? 'sep_entry').trim();

	type Row = {
		url: string;
		source_type: string;
		why: string | null;
		neon_last_done_run: null | { run_id: string; completed_at: string; validate: boolean };
	};

	const rows: Row[] = golden.items.map((it) => ({
		url: it.url.trim(),
		source_type: (it.source_type ?? def).trim(),
		why: typeof it.why === 'string' ? it.why : null,
		neon_last_done_run: null
	}));

	if (process.env.DATABASE_URL?.trim()) {
		const db = getDrizzleDb();
		for (const row of rows) {
			const u = row.url.trim();
			const canonKey = canonicalizeSourceUrl(u);
			const [r] = await db
				.select()
				.from(ingestRuns)
				.where(
					and(
						eq(ingestRuns.status, 'done'),
						canonKey
							? sql`regexp_replace(lower(trim(${ingestRuns.sourceUrl})), '/+$', '') = regexp_replace(lower(${canonKey}::text), '/+$', '')`
							: sql`lower(trim(${ingestRuns.sourceUrl})) = lower(${u})`
					)
				)
				.orderBy(desc(ingestRuns.completedAt))
				.limit(1);
			if (r) {
				const payload =
					r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload)
						? (r.payload as Record<string, unknown>)
						: {};
				row.neon_last_done_run = {
					run_id: r.id,
					completed_at: r.completedAt?.toISOString() ?? '',
					validate: payload.validate === true
				};
			}
		}
	}

	const manifest = {
		generatedAt: new Date().toISOString(),
		goldenVersion: golden.version,
		goldenFingerprint: fp,
		default_source_type: def,
		urls: rows
	};

	const outPath = parseOut();
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
	console.log(`Wrote ${outPath} (${rows.length} URLs)`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
