/**
 * Phase 1 / G0 — training-oriented JSONL export from Neon `ingest_staging_claims` for the
 * **training-acceptable** cohort (same rules as `listTrainingAcceptableUrlsFromNeon`).
 *
 * - Validates each `claim_data` row with `ExtractionClaimSchema` (see extraction schema pointer in manifest).
 * - Dedupe key: `(canonical_url_hash, position_in_source)` — cohort already picks latest run per URL.
 * - Splits lines into **golden_holdout** (golden URLs) vs non-golden pool.
 * - **G0 (default):** stratified **80 / 10 / 10** by **canonical URL** (no URL appears in more than one of
 *   train / validation / test); golden URLs never appear in stratified files.
 * - **Legacy:** `--no-stratified` writes a single **train.jsonl** for all non-golden lines (Phase 1 baseline shape).
 * - Optional **`--minhash-dedupe`**: within each output shard, drop **exact** duplicates on NFKC-normalized `input`, then optional SimHash near-duplicates (hamming ≤ 5 on 64-bit SimHash of word tokens).
 * - Optional **`--passage-context`**: adds `passage_context_excerpt` from `ingest_staging_meta.source_text_snapshot` when present.
 * - Writes a **sidecar manifest** per mitigation plan §4.
 *
 *   pnpm ops:phase1-export-training-jsonl
 *   pnpm exec tsx scripts/export-phase1-training-jsonl.ts -- --days=90 --out-dir=data/phase1-training-export
 *   pnpm exec tsx scripts/export-phase1-training-jsonl.ts -- --no-stratified
 *
 * G1 (ToS / policy shards, mitigation §8 / §9 M9.23):
 *   --g1-allow-extraction-prefix=mistral/   (repeatable; only runs whose persisted `stage_models.extraction` starts with a prefix)
 *   --g1-shard-by-provider                (write separate JSONL per extraction provider segment, e.g. train.mistral.jsonl, train.vertex.jsonl)
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inArray } from 'drizzle-orm';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRuns, ingestStagingClaims, ingestStagingMeta } from '../src/lib/server/db/schema.ts';
import { ExtractionClaimSchema } from '../src/lib/server/prompts/extraction.ts';
import {
	goldenExtractionEvalFingerprint,
	loadGoldenExtractionEval
} from '../src/lib/server/ingestion/goldenExtractionEval.ts';
import { listTrainingAcceptableUrlsFromNeon } from '../src/lib/server/ingestion/trainingAcceptableCohortNeon.ts';
import { isNeonIngestPersistenceEnabled } from '../src/lib/server/neon/datastore.ts';
import { canonicalizeAndHashSourceUrl, canonicalizeSourceUrl } from '../src/lib/server/sourceIdentity.ts';

loadServerEnv();

const EXTRACTION_CLAIM_SCHEMA_POINTER =
	'src/lib/server/prompts/extraction.ts#ExtractionClaimSchema (Zod; ingestion extraction output shape)';

const MASK64 = (1n << 64n) - 1n;
const SIMHASH_NEAR_THRESHOLD = 5;

/** SEP entries that repeatedly failed automated ingest — revisit Phase 0 cohort counts if replacements are not added. */
export const KNOWN_FAILED_TRAINING_SOURCE_URLS = [
	'https://plato.stanford.edu/entries/spinoza/',
	'https://plato.stanford.edu/entries/hume/'
] as const;

type SplitName = 'train' | 'validation' | 'test' | 'golden_holdout';

type JsonlLine = {
	source_url: string;
	canonical_url_hash: string | null;
	run_id: string;
	position_in_source: number;
	input: string;
	label: Record<string, unknown>;
	split: SplitName;
	passage_context_excerpt?: string | null;
};

function parseArgs() {
	const argv = process.argv;
	const hasFlag = (name: string) => argv.includes(name);
	const daysArg = argv.find((x) => x.startsWith('--days='));
	const outArg = argv.find((x) => x.startsWith('--out-dir='));
	const limitArg = argv.find((x) => x.startsWith('--limit='));
	const days = daysArg ? Math.min(730, Math.max(1, parseInt(daysArg.slice('--days='.length), 10) || 90)) : 90;
	const limit = limitArg
		? Math.min(5000, Math.max(1, parseInt(limitArg.slice('--limit='.length), 10) || 500))
		: 5000;
	const outDir = outArg?.slice('--out-dir='.length)?.trim() || 'data/phase1-training-export';
	/** Default G0 stratified; `--no-stratified` or `--phase1-baseline` restores single train.jsonl. */
	const stratified = !hasFlag('--no-stratified') && !hasFlag('--phase1-baseline');
	const minhashDedupe = hasFlag('--minhash-dedupe');
	const passageContext = hasFlag('--passage-context');
	const g1ShardByProvider = hasFlag('--g1-shard-by-provider');
	const g1AllowExtractionPrefix = argv
		.filter((x) => x.startsWith('--g1-allow-extraction-prefix='))
		.map((x) => x.slice('--g1-allow-extraction-prefix='.length).trim())
		.filter(Boolean);
	return {
		days,
		limit,
		outDir,
		stratified,
		minhashDedupe,
		passageContext,
		g1ShardByProvider,
		g1AllowExtractionPrefix
	} as const;
}

function extractionModelFromEnvelope(env: Record<string, unknown> | null): string | null {
	if (!env) return null;
	const tt = env.timingTelemetry;
	if (!tt || typeof tt !== 'object' || Array.isArray(tt)) return null;
	const sm = (tt as { stage_models?: unknown }).stage_models;
	if (!sm || typeof sm !== 'object' || Array.isArray(sm)) return null;
	const ex = (sm as Record<string, unknown>).extraction;
	return typeof ex === 'string' && ex.trim() ? ex.trim() : null;
}

function extractionProviderSegment(model: string | null): string {
	if (!model?.trim()) return 'unknown';
	const m = model.trim();
	const i = m.indexOf('/');
	return i === -1 ? m : m.slice(0, i);
}

function passesG1ExtractionPrefixFilter(model: string | null, prefixes: readonly string[]): boolean {
	if (prefixes.length === 0) return true;
	if (!model?.trim()) return false;
	return prefixes.some((p) => model.startsWith(p));
}

function stratifyBucketFromUrlKey(urlKey: string): 'train' | 'validation' | 'test' {
	const h = createHash('sha256').update('g0-stratify-v1').update(urlKey).digest();
	const b = h[0]! % 10;
	if (b < 8) return 'train';
	if (b === 8) return 'validation';
	return 'test';
}

function normalizeForDedupe(s: string): string {
	return s.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}

function simhash64(text: string): bigint {
	const tokens = text.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return 0n;
	const vec = new Array<number>(64).fill(0);
	for (const t of tokens) {
		const buf = createHash('sha256').update(t).digest();
		const h = buf.readBigUInt64BE(0);
		for (let i = 0; i < 64; i++) {
			vec[i] += (h >> BigInt(i)) & 1n ? 1 : -1;
		}
	}
	let out = 0n;
	for (let i = 0; i < 64; i++) {
		if (vec[i]! > 0) out |= 1n << BigInt(i);
	}
	return out & MASK64;
}

function hamming64(a: bigint, b: bigint): number {
	let x = (a ^ b) & MASK64;
	let c = 0;
	while (x) {
		c++;
		x &= x - 1n;
	}
	return c;
}

/**
 * Passage-style excerpt: prefer window around claim text in snapshot; else prefix of snapshot.
 */
function passageExcerptFromSnapshot(
	snapshot: string | null | undefined,
	claimText: string,
	radius = 800,
	prefixMax = 2000
): string | null {
	if (!snapshot?.trim()) return null;
	const trimmed = claimText.trim();
	if (!trimmed) return snapshot.slice(0, prefixMax);
	const needle = trimmed.slice(0, Math.min(96, trimmed.length));
	const idx = snapshot.indexOf(needle);
	if (idx === -1) return snapshot.slice(0, prefixMax);
	const start = Math.max(0, idx - radius);
	const end = Math.min(snapshot.length, idx + trimmed.length + radius);
	return snapshot.slice(start, end);
}

function jsonLinesToStrings(lines: JsonlLine[]): string[] {
	return lines.map((l) => JSON.stringify(l));
}

/** Exact dedupe on normalized input, then optional SimHash near-dedupe within the shard. */
function dedupeShardLines(jsonlStrings: string[], enableNear: boolean): { lines: string[]; droppedExact: number; droppedNear: number } {
	const kept: string[] = [];
	const seenNorm = new Set<string>();
	let droppedExact = 0;
	const sigs: bigint[] = [];
	let droppedNear = 0;

	for (const js of jsonlStrings) {
		let input: string;
		try {
			const o = JSON.parse(js) as { input?: string };
			input = typeof o.input === 'string' ? o.input : '';
		} catch {
			kept.push(js);
			continue;
		}
		const norm = normalizeForDedupe(input);
		if (seenNorm.has(norm)) {
			droppedExact++;
			continue;
		}
		seenNorm.add(norm);

		if (!enableNear) {
			kept.push(js);
			continue;
		}

		const sig = simhash64(norm);
		let near = false;
		for (const prev of sigs) {
			if (hamming64(sig, prev) <= SIMHASH_NEAR_THRESHOLD) {
				near = true;
				break;
			}
		}
		if (near) {
			droppedNear++;
			continue;
		}
		sigs.push(sig);
		kept.push(js);
	}

	return { lines: kept, droppedExact, droppedNear };
}

function partitionByProvider(
	lines: JsonlLine[],
	labelModelByRun: Record<string, string | null>
): Map<string, JsonlLine[]> {
	const m = new Map<string, JsonlLine[]>();
	for (const line of lines) {
		const p = extractionProviderSegment(labelModelByRun[line.run_id] ?? null);
		const arr = m.get(p) ?? [];
		arr.push(line);
		m.set(p, arr);
	}
	return m;
}

function safeProvSeg(prov: string): string {
	const s = prov.replace(/[^a-zA-Z0-9._-]+/g, '_');
	return s || 'unknown';
}

function stringifyAndMaybeDedupe(lines: JsonlLine[], minhashDedupe: boolean) {
	const jsonl = jsonLinesToStrings(lines);
	if (!minhashDedupe) return { lines: jsonl, droppedExact: 0, droppedNear: 0 };
	return dedupeShardLines(jsonl, true);
}

async function main() {
	if (!process.env.DATABASE_URL?.trim()) {
		console.error('DATABASE_URL is required.');
		process.exit(1);
	}
	if (!isNeonIngestPersistenceEnabled()) {
		console.error('Neon ingest persistence is not enabled (check env / feature flags).');
		process.exit(1);
	}

	const {
		days,
		limit,
		outDir,
		stratified,
		minhashDedupe,
		passageContext,
		g1ShardByProvider,
		g1AllowExtractionPrefix
	} = parseArgs();
	mkdirSync(outDir, { recursive: true });

	const golden = loadGoldenExtractionEval();
	const goldenFp = goldenExtractionEvalFingerprint(golden.items);
	const goldenCanon = new Set<string>();
	for (const it of golden.items) {
		const c = canonicalizeSourceUrl(it.url.trim());
		if (c) goldenCanon.add(c);
	}

	const { urls: cohortRows, cohortMeta } = await listTrainingAcceptableUrlsFromNeon({
		days,
		limit,
		validateOnly: false,
		omitValidatedTelemetry: false
	});
	if (cohortRows.length === 0) {
		console.error('No training-acceptable URLs in window — nothing to export.');
		process.exit(1);
	}

	const runIds = [...new Set(cohortRows.map((r) => r.runId))];
	const db = getDrizzleDb();

	const runRows = await db.select().from(ingestRuns).where(inArray(ingestRuns.id, runIds));
	const runById = new Map(runRows.map((r) => [r.id, r]));

	const claimRows = await db.select().from(ingestStagingClaims).where(inArray(ingestStagingClaims.runId, runIds));

	const metaRows = passageContext
		? await db.select().from(ingestStagingMeta).where(inArray(ingestStagingMeta.runId, runIds))
		: [];
	const snapshotByRun = new Map(metaRows.map((m) => [m.runId, m.sourceTextSnapshot]));

	const claimsByRun = new Map<string, (typeof ingestStagingClaims.$inferSelect)[]>();
	for (const c of claimRows) {
		const arr = claimsByRun.get(c.runId) ?? [];
		arr.push(c);
		claimsByRun.set(c.runId, arr);
	}
	for (const arr of claimsByRun.values()) {
		arr.sort((a, b) => a.positionInSource - b.positionInSource);
	}

	const pending: JsonlLine[] = [];
	let invalidClaims = 0;
	const seenUnit = new Set<string>();
	let dedupeDropped = 0;

	const labelModelByRun: Record<string, string | null> = {};
	let g1CohortRowsSkipped = 0;

	for (const row of cohortRows) {
		const ir = runById.get(row.runId);
		const env =
			ir?.reportEnvelope && typeof ir.reportEnvelope === 'object' && !Array.isArray(ir.reportEnvelope)
				? (ir.reportEnvelope as Record<string, unknown>)
				: null;
		labelModelByRun[row.runId] = extractionModelFromEnvelope(env);

		if (!passesG1ExtractionPrefixFilter(labelModelByRun[row.runId], g1AllowExtractionPrefix)) {
			g1CohortRowsSkipped++;
			continue;
		}

		const identity = canonicalizeAndHashSourceUrl(row.url);
		const canon = identity?.canonicalUrl ?? canonicalizeSourceUrl(row.url);
		const hash = identity?.canonicalUrlHash ?? null;
		const isGolden = canon ? goldenCanon.has(canon) : false;
		const urlKey = hash ?? canon ?? row.runId;

		const claims = claimsByRun.get(row.runId) ?? [];
		const snap = passageContext ? snapshotByRun.get(row.runId) : undefined;

		for (const cl of claims) {
			const parsed = ExtractionClaimSchema.safeParse(cl.claimData);
			if (!parsed.success) {
				invalidClaims++;
				continue;
			}
			const unitKey = `${hash ?? canon ?? row.runId}:${cl.positionInSource}`;
			if (seenUnit.has(unitKey)) {
				dedupeDropped++;
				continue;
			}
			seenUnit.add(unitKey);

			let split: SplitName;
			if (isGolden) {
				split = 'golden_holdout';
			} else if (stratified) {
				split = stratifyBucketFromUrlKey(urlKey);
			} else {
				split = 'train';
			}

			const line: JsonlLine = {
				source_url: row.url.trim(),
				canonical_url_hash: hash,
				run_id: row.runId,
				position_in_source: cl.positionInSource,
				input: cl.claimText.trim(),
				label: parsed.data as unknown as Record<string, unknown>,
				split
			};
			if (passageContext) {
				line.passage_context_excerpt = passageExcerptFromSnapshot(snap ?? null, cl.claimText);
			}
			pending.push(line);
		}
	}

	const cohortFpSourceRows =
		g1AllowExtractionPrefix.length > 0
			? cohortRows.filter((r) =>
					passesG1ExtractionPrefixFilter(labelModelByRun[r.runId], g1AllowExtractionPrefix)
				)
			: cohortRows;

	const cohortFp = createHash('sha256')
		.update(
			cohortFpSourceRows
				.map((r) => canonicalizeSourceUrl(r.url) ?? r.url.trim().toLowerCase())
				.sort()
				.join('\n')
		)
		.digest('hex')
		.slice(0, 16);

	if (pending.length === 0) {
		console.error(
			g1AllowExtractionPrefix.length
				? 'No claim lines after G1 extraction-prefix filter — widen prefixes or check cohort.'
				: 'No exportable claim lines — nothing to write.'
		);
		process.exit(1);
	}

	const goldenLines = pending.filter((l) => l.split === 'golden_holdout');
	const nonGolden = pending.filter((l) => l.split !== 'golden_holdout');

	let trainLines: JsonlLine[] = [];
	let validationLines: JsonlLine[] = [];
	let testLines: JsonlLine[] = [];

	if (stratified) {
		trainLines = nonGolden.filter((l) => l.split === 'train');
		validationLines = nonGolden.filter((l) => l.split === 'validation');
		testLines = nonGolden.filter((l) => l.split === 'test');
	} else {
		trainLines = nonGolden;
	}

	let minhashNearDropped = { train: 0, validation: 0, test: 0 };
	let exactDedupeDropped = { train: 0, validation: 0, test: 0 };
	let goldenExactDropped = 0;
	let goldenNearDropped = 0;

	let countTrain = 0;
	let countVal = 0;
	let countTest = 0;
	let countGolden = 0;
	const writtenJsonlFiles: string[] = [];

	const writeJsonl = (name: string, lines: string[]) => {
		writeFileSync(join(outDir, name), lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
	};

	const phase =
		g1ShardByProvider
			? 'g1_training_jsonl_sharded'
			: g1AllowExtractionPrefix.length > 0
				? 'g1_training_jsonl_filtered'
				: stratified
					? 'g0_training_jsonl_stratified'
					: 'phase1_training_jsonl_baseline';

	if (g1ShardByProvider) {
		const pt = partitionByProvider(trainLines, labelModelByRun);
		const pv = stratified ? partitionByProvider(validationLines, labelModelByRun) : new Map<string, JsonlLine[]>();
		const pte = stratified ? partitionByProvider(testLines, labelModelByRun) : new Map<string, JsonlLine[]>();
		const pg = partitionByProvider(goldenLines, labelModelByRun);

		const provs = new Set<string>([...pt.keys(), ...pv.keys(), ...pte.keys(), ...pg.keys()]);
		for (const prov of [...provs].sort()) {
			const safe = safeProvSeg(prov);

			const tr = stringifyAndMaybeDedupe(pt.get(prov) ?? [], minhashDedupe);
			if (tr.lines.length > 0) {
				writeJsonl(`train.${safe}.jsonl`, tr.lines);
				writtenJsonlFiles.push(`train.${safe}.jsonl`);
				countTrain += tr.lines.length;
				exactDedupeDropped.train += tr.droppedExact;
				minhashNearDropped.train += tr.droppedNear;
			}

			if (stratified) {
				const va = stringifyAndMaybeDedupe(pv.get(prov) ?? [], minhashDedupe);
				if (va.lines.length > 0) {
					writeJsonl(`validation.${safe}.jsonl`, va.lines);
					writtenJsonlFiles.push(`validation.${safe}.jsonl`);
					countVal += va.lines.length;
					exactDedupeDropped.validation += va.droppedExact;
					minhashNearDropped.validation += va.droppedNear;
				}
				const te = stringifyAndMaybeDedupe(pte.get(prov) ?? [], minhashDedupe);
				if (te.lines.length > 0) {
					writeJsonl(`test.${safe}.jsonl`, te.lines);
					writtenJsonlFiles.push(`test.${safe}.jsonl`);
					countTest += te.lines.length;
					exactDedupeDropped.test += te.droppedExact;
					minhashNearDropped.test += te.droppedNear;
				}
			}

			const go = stringifyAndMaybeDedupe(pg.get(prov) ?? [], minhashDedupe);
			if (go.lines.length > 0) {
				writeJsonl(`golden_holdout.${safe}.jsonl`, go.lines);
				writtenJsonlFiles.push(`golden_holdout.${safe}.jsonl`);
				countGolden += go.lines.length;
				goldenExactDropped += go.droppedExact;
				goldenNearDropped += go.droppedNear;
			}
		}
	} else {
		const tr = stringifyAndMaybeDedupe(trainLines, minhashDedupe);
		const trainJsonl = tr.lines;
		countTrain = trainJsonl.length;
		exactDedupeDropped.train = tr.droppedExact;
		minhashNearDropped.train = tr.droppedNear;

		let valJsonl: string[] = [];
		let testJsonl: string[] = [];
		if (stratified) {
			const va = stringifyAndMaybeDedupe(validationLines, minhashDedupe);
			valJsonl = va.lines;
			countVal = valJsonl.length;
			exactDedupeDropped.validation = va.droppedExact;
			minhashNearDropped.validation = va.droppedNear;

			const te = stringifyAndMaybeDedupe(testLines, minhashDedupe);
			testJsonl = te.lines;
			countTest = testJsonl.length;
			exactDedupeDropped.test = te.droppedExact;
			minhashNearDropped.test = te.droppedNear;
		}

		const go = stringifyAndMaybeDedupe(goldenLines, minhashDedupe);
		const goldenJsonl = go.lines;
		countGolden = goldenJsonl.length;
		goldenExactDropped = go.droppedExact;
		goldenNearDropped = go.droppedNear;

		writeJsonl('train.jsonl', trainJsonl);
		writtenJsonlFiles.push('train.jsonl');
		if (stratified) {
			writeJsonl('validation.jsonl', valJsonl);
			writeJsonl('test.jsonl', testJsonl);
			writtenJsonlFiles.push('validation.jsonl', 'test.jsonl');
		}
		writeJsonl('golden_holdout.jsonl', goldenJsonl);
		writtenJsonlFiles.push('golden_holdout.jsonl');
	}

	const exportedRunIds = [...new Set(pending.map((l) => l.run_id))].sort();

	const manifest = {
		generatedAt: new Date().toISOString(),
		phase,
		exportPolicies: {
			stratified_split_80_10_10_by_canonical_url: stratified,
			golden_urls_excluded_from_train_val_test: true,
			g1_allow_extraction_prefix: g1AllowExtractionPrefix.length > 0 ? [...g1AllowExtractionPrefix] : null,
			g1_shard_by_extraction_provider: g1ShardByProvider,
			g1_cohort_rows_skipped_by_extraction_prefix:
				g1AllowExtractionPrefix.length > 0 ? g1CohortRowsSkipped : null,
			minhash_near_dedupe: minhashDedupe,
			minhash_hamming_threshold: minhashDedupe ? SIMHASH_NEAR_THRESHOLD : null,
			passage_context_from_ingest_staging_meta: passageContext,
			normalized_input_exact_dedupe_within_shard: minhashDedupe
		},
		extractionClaimSchemaPointer: EXTRACTION_CLAIM_SCHEMA_POINTER,
		notLegalAdvice:
			'Organisation-internal training-data decision is recorded in docs/local/operations/ingestion-fine-tune-data-mitigation-plan.md; third-party API ToS still govern live calls.',
		cohort: {
			days,
			limit,
			scannedRunCount: cohortMeta.scannedRunCount,
			trainingAcceptableUrlCount: cohortRows.length,
			trainingAcceptableUrlsAfterG1ExtractionPrefix: g1AllowExtractionPrefix.length
				? cohortFpSourceRows.length
				: null,
			cohortFingerprintSha256_16: cohortFp
		},
		goldenSet: {
			version: golden.version,
			fingerprintSha256_16: goldenFp,
			trainValTestFilesExcludeTheseCanonicalUrls: true
		},
		exports: g1ShardByProvider
			? {
					jsonl_files: writtenJsonlFiles,
					manifest_json: 'manifest.json',
					note: 'Per extraction provider segment (string before / in stage_models.extraction), e.g. train.mistral.jsonl'
				}
			: stratified
				? {
						train_jsonl: 'train.jsonl',
						validation_jsonl: 'validation.jsonl',
						test_jsonl: 'test.jsonl',
						golden_holdout_jsonl: 'golden_holdout.jsonl',
						manifest_json: 'manifest.json'
					}
				: {
						train_jsonl: 'train.jsonl',
						golden_holdout_jsonl: 'golden_holdout.jsonl',
						manifest_json: 'manifest.json'
					},
		counts: stratified
			? {
					train_lines: countTrain,
					validation_lines: countVal,
					test_lines: countTest,
					golden_holdout_lines: countGolden,
					invalid_claim_rows_skipped: invalidClaims,
					dedupe_dropped_same_hash_position: dedupeDropped,
					normalized_input_exact_dedupe_dropped: minhashDedupe ? exactDedupeDropped : null,
					minhash_near_dedupe_dropped: minhashDedupe
						? { ...minhashNearDropped, golden_holdout: goldenNearDropped }
						: null,
					golden_holdout_exact_dedupe_dropped: minhashDedupe ? goldenExactDropped : null
				}
			: {
					train_lines: countTrain,
					golden_holdout_lines: countGolden,
					invalid_claim_rows_skipped: invalidClaims,
					dedupe_dropped_same_hash_position: dedupeDropped,
					normalized_input_exact_dedupe_dropped: minhashDedupe ? exactDedupeDropped.train : null,
					minhash_near_dedupe_dropped: minhashDedupe
						? { train: minhashNearDropped.train, golden_holdout: goldenNearDropped }
						: null,
					golden_holdout_exact_dedupe_dropped: minhashDedupe ? goldenExactDropped : null
				},
		provenance: {
			neon_run_ids: exportedRunIds,
			extraction_model_by_run_id: labelModelByRun
		},
		known_gaps: {
			phase0_refresh:
				'Re-run Phase 0 aggregates after cohort changes; two SEP URLs repeatedly failed ingest — see known_failed_source_urls.',
			near_duplicate_policy: minhashDedupe
				? `simhash64 word-token; hamming<=${SIMHASH_NEAR_THRESHOLD} drops within shard (after exact normalized-input dedupe)`
				: 'none (no within-shard input dedupe); pass --minhash-dedupe for exact+SimHash near-dedupe per shard',
			stratified_split: g1ShardByProvider
				? 'same URL stratification as G0, then split output files by extraction provider segment (--g1-shard-by-provider)'
				: stratified
					? 'sha256("g0-stratify-v1" || urlKey)[0] % 10 → buckets 0–7 train, 8 val, 9 test; urlKey = canonical_url_hash || canonical_url || run_id'
					: 'single train.jsonl for all non-golden lines (--no-stratified)',
			g1_mixing:
				'Do not fine-tune on mixed provider shards without manifest tagging (mitigation §9 M9.23). Use --g1-allow-extraction-prefix and/or --g1-shard-by-provider.'
		},
		known_failed_source_urls: [...KNOWN_FAILED_TRAINING_SOURCE_URLS]
	};

	writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

	console.log(
		JSON.stringify(
			{
				outDir,
				stratified,
				...manifest.counts,
				cohortFingerprintSha256_16: cohortFp,
				goldenFingerprintSha256_16: goldenFp
			},
			null,
			2
		)
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
