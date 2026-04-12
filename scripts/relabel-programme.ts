/**
 * §9.5 relabel programme — inventory (Surreal), training sidecar template, Neon extraction map.
 *
 *   pnpm ops:relabel-inventory
 *   pnpm ops:relabel-sep-list
 *   pnpm exec tsx --env-file=.env scripts/relabel-programme.ts inventory --status=ingested --limit=10
 *   pnpm exec tsx scripts/relabel-programme.ts training-sidecar --from=data/relabel-inventory.json
 *   pnpm exec tsx --env-file=.env scripts/relabel-programme.ts neon-map --from=data/relabel-inventory.json
 *
 * Surreal: SURREAL_* (same as build-reingestion-manifest). Neon: DATABASE_URL (neon-map only).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { Surreal } from 'surrealdb';
import { signinSurrealWithFallback } from './lib/surrealSignin.js';
import { loadServerEnv } from '../src/lib/server/env.ts';
import { getDrizzleDb } from '../src/lib/server/db/neon.ts';
import { ingestRuns } from '../src/lib/server/db/schema.ts';
import { resolveSurrealRpcUrl } from '../src/lib/server/surrealEnv.ts';
import { canonicalizeSourceUrl } from '../src/lib/server/sourceIdentity.js';

const DEFAULT_OUT_DIR = path.join(process.cwd(), 'data');
const DEFAULT_INVENTORY_JSON = path.join(DEFAULT_OUT_DIR, 'relabel-inventory.json');
const DEFAULT_INVENTORY_CSV = path.join(DEFAULT_OUT_DIR, 'relabel-inventory.csv');
const DEFAULT_SIDECAR = path.join(DEFAULT_OUT_DIR, 'training-relabel-sidecar.json');
const DEFAULT_NEON_MAP = path.join(DEFAULT_OUT_DIR, 'relabel-neon-extraction-by-url.json');
const DEFAULT_SEP_REINGEST_JSON = path.join(DEFAULT_OUT_DIR, 'sep-reingest-sources.json');
const DEFAULT_SEP_REINGEST_URLS = path.join(DEFAULT_OUT_DIR, 'sep-reingest-urls.txt');

const SURREAL_NAMESPACE = () => process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = () => process.env.SURREAL_DATABASE || 'sophia';

export interface RelabelInventoryRow {
	source_id: string;
	url: string | null;
	canonical_url: string | null;
	canonical_url_hash: string | null;
	ingested_at: string | null;
	title: string | null;
	status: string | null;
	claim_count: number | null;
	/** When true, omit from training / fine-tune exports (Surreal + Neon governance). */
	exclude_from_model_training: boolean | null;
}

export interface SepReingestRow extends RelabelInventoryRow {
	source_type: string | null;
}

interface SurrealSourceRow {
	id: unknown;
	title?: string;
	url?: string | null;
	canonical_url?: string | null;
	canonical_url_hash?: string | null;
	source_type?: string | null;
	status?: string | null;
	claim_count?: number | null;
	ingested_at?: unknown;
	exclude_from_model_training?: boolean | null;
}

function stringifySurrealId(id: unknown): string {
	if (id == null) return '';
	if (typeof id === 'string') return id;
	if (typeof id === 'object' && id !== null && 'toString' in id) {
		return String((id as { toString(): string }).toString());
	}
	return String(id);
}

function isoFromSurrealDate(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === 'string') return v;
	if (v instanceof Date) return v.toISOString();
	return String(v);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
	const out: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] ?? '';
		if (a === '--from' && argv[i + 1]) {
			out.from = argv[++i]!;
			continue;
		}
		if (a.startsWith('--out-dir=')) {
			out.outDir = a.slice('--out-dir='.length);
			continue;
		}
		if (a.startsWith('--out=')) {
			out.out = a.slice('--out='.length);
			continue;
		}
		if (a.startsWith('--status=')) {
			out.status = a.slice('--status='.length);
			continue;
		}
		if (a.startsWith('--limit=')) {
			out.limit = a.slice('--limit='.length);
			continue;
		}
		if (a.startsWith('--format=')) {
			out.format = a.slice('--format='.length);
			continue;
		}
		if (a.startsWith('--urls-out=')) {
			out.urlsOut = a.slice('--urls-out='.length);
			continue;
		}
	}
	return out;
}

function csvEscape(s: string | null | undefined): string {
	if (s == null || s === '') return '';
	const t = String(s);
	if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
	return t;
}

function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

async function cmdInventory(argv: string[]): Promise<void> {
	loadServerEnv();
	const flags = parseArgs(argv);
	const outDir = typeof flags.outDir === 'string' ? flags.outDir : DEFAULT_OUT_DIR;
	const status = typeof flags.status === 'string' ? flags.status.trim().toLowerCase() : 'all';
	const limitRaw = typeof flags.limit === 'string' ? parseInt(flags.limit, 10) : 0;
	const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 0;
	const format = typeof flags.format === 'string' ? flags.format.toLowerCase() : 'both';
	const writeJson = format === 'json' || format === 'both';
	const writeCsv = format === 'csv' || format === 'both';

	fs.mkdirSync(outDir, { recursive: true });
	const jsonPath = path.join(outDir, 'relabel-inventory.json');
	const csvPath = path.join(outDir, 'relabel-inventory.csv');

	const rpcUrl = resolveSurrealRpcUrl();
	const db = new Surreal();
	try {
		await db.connect(rpcUrl);
		await signinSurrealWithFallback(db);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(
			`${msg}\n` +
				'Hint: set SURREAL_URL or SURREAL_INSTANCE+SURREAL_HOSTNAME; SURREAL_USER/SURREAL_PASS; optional SURREAL_ACCESS for Cloud. ' +
				'Use .env.local for secrets — run via `pnpm ops:relabel-inventory` (loads .env then .env.local) or `tsx --env-file=.env --env-file=.env.local ...`.'
		);
	}
	await db.use({ namespace: SURREAL_NAMESPACE(), database: SURREAL_DATABASE() });

	const allowedStatus = new Set(['pending', 'ingested', 'validated', 'quarantined', 'all']);
	if (!allowedStatus.has(status)) {
		throw new Error(`Invalid --status=${status} (use pending|ingested|validated|quarantined|all)`);
	}

	let surrealSql =
		'SELECT id, title, url, canonical_url, canonical_url_hash, status, claim_count, ingested_at, exclude_from_model_training FROM source';
	if (status !== 'all') {
		surrealSql += ` WHERE string::lowercase(status) = '${status}'`;
	}
	surrealSql += ' ORDER BY ingested_at DESC';
	if (limit > 0) {
		surrealSql += ` LIMIT ${limit}`;
	}

	const res = await db.query<SurrealSourceRow[][]>(surrealSql);
	await db.close();

	const rawRows = Array.isArray(res?.[0]) ? res[0] : [];
	const rows: RelabelInventoryRow[] = rawRows.map((r) => ({
		source_id: stringifySurrealId(r.id),
		url: r.url ?? null,
		canonical_url: r.canonical_url ?? null,
		canonical_url_hash: r.canonical_url_hash ?? null,
		ingested_at: isoFromSurrealDate(r.ingested_at),
		title: typeof r.title === 'string' ? r.title : null,
		status: r.status ?? null,
		claim_count: typeof r.claim_count === 'number' ? r.claim_count : null,
		exclude_from_model_training:
			typeof r.exclude_from_model_training === 'boolean' ? r.exclude_from_model_training : null
	}));

	const doc = {
		generated_at: new Date().toISOString(),
		generated_by: 'scripts/relabel-programme.ts inventory',
		surreal: {
			rpc_url: rpcUrl,
			namespace: SURREAL_NAMESPACE(),
			database: SURREAL_DATABASE(),
			filter_status: status,
			limit: limit || null
		},
		row_count: rows.length,
		rows
	};

	if (writeJson) {
		fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
		console.log(`[relabel] wrote ${jsonPath} (${rows.length} rows)`);
	}
	if (writeCsv) {
		const header = [
			'source_id',
			'url',
			'canonical_url',
			'canonical_url_hash',
			'ingested_at',
			'title',
			'status',
			'claim_count',
			'exclude_from_model_training'
		];
		const lines = [
			header.join(','),
			...rows.map((r) =>
				[
					csvEscape(r.source_id),
					csvEscape(r.url),
					csvEscape(r.canonical_url),
					csvEscape(r.canonical_url_hash),
					csvEscape(r.ingested_at),
					csvEscape(r.title),
					csvEscape(r.status),
					r.claim_count != null ? String(r.claim_count) : '',
					r.exclude_from_model_training != null ? String(r.exclude_from_model_training) : ''
				].join(',')
			)
		];
		fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf-8');
		console.log(`[relabel] wrote ${csvPath}`);
	}
}

async function cmdSepReingestList(argv: string[]): Promise<void> {
	loadServerEnv();
	const flags = parseArgs(argv);
	const outDir = typeof flags.outDir === 'string' ? flags.outDir : DEFAULT_OUT_DIR;
	const status = typeof flags.status === 'string' ? flags.status.trim().toLowerCase() : 'ingested';
	const jsonPath =
		typeof flags.out === 'string' ? flags.out : path.join(outDir, path.basename(DEFAULT_SEP_REINGEST_JSON));
	const jsonAbs = path.resolve(jsonPath);
	const urlsPath =
		typeof flags.urlsOut === 'string'
			? flags.urlsOut
			: path.join(
					path.dirname(jsonAbs),
					`${path.basename(jsonAbs, path.extname(jsonAbs))}-urls.txt`
				);

	const allowedStatus = new Set(['pending', 'ingested', 'validated', 'quarantined', 'all']);
	if (!allowedStatus.has(status)) {
		throw new Error(`Invalid --status=${status} (use pending|ingested|validated|quarantined|all)`);
	}

	const rpcUrl = resolveSurrealRpcUrl();
	const db = new Surreal();
	try {
		await db.connect(rpcUrl);
		await signinSurrealWithFallback(db);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(
			`${msg}\n` +
				'Hint: set SURREAL_URL (or INSTANCE+HOSTNAME), SURREAL_USER/SURREAL_PASS, SURREAL_NAMESPACE/DATABASE. Use `pnpm ops:relabel-sep-list` or tsx with .env + .env.local.'
		);
	}
	await db.use({ namespace: SURREAL_NAMESPACE(), database: SURREAL_DATABASE() });

	let surrealSql =
		'SELECT id, title, url, canonical_url, canonical_url_hash, source_type, status, claim_count, ingested_at, exclude_from_model_training FROM source WHERE (string::lowercase(type::string(source_type)) = \'sep_entry\' OR (string::contains(string::lowercase(type::string(url)), \'plato.stanford.edu\') AND string::contains(string::lowercase(type::string(url)), \'/entries/\')))';
	if (status !== 'all') {
		surrealSql += ` AND string::lowercase(type::string(status)) = '${status}'`;
	}
	surrealSql += ' ORDER BY ingested_at DESC';

	const res = await db.query<SurrealSourceRow[][]>(surrealSql);
	await db.close();

	const rawRows = Array.isArray(res?.[0]) ? res[0] : [];
	const rows: SepReingestRow[] = rawRows.map((r) => ({
		source_id: stringifySurrealId(r.id),
		url: r.url ?? null,
		canonical_url: r.canonical_url ?? null,
		canonical_url_hash: r.canonical_url_hash ?? null,
		ingested_at: isoFromSurrealDate(r.ingested_at),
		title: typeof r.title === 'string' ? r.title : null,
		status: r.status ?? null,
		claim_count: typeof r.claim_count === 'number' ? r.claim_count : null,
		source_type: typeof r.source_type === 'string' ? r.source_type : null,
		exclude_from_model_training:
			typeof r.exclude_from_model_training === 'boolean' ? r.exclude_from_model_training : null
	}));

	const seenUrl = new Set<string>();
	const urlLines: string[] = [];
	for (const r of rows) {
		const u = (r.canonical_url ?? r.url ?? '').trim();
		if (!u || seenUrl.has(u)) continue;
		seenUrl.add(u);
		urlLines.push(u);
	}

	const doc = {
		generated_at: new Date().toISOString(),
		generated_by: 'scripts/relabel-programme.ts sep-reingest-list',
		note: 'Rows are Surreal `source` records: `source_type = sep_entry` OR Stanford Plato `/entries/` URLs (covers legacy rows missing source_type). Default --status=ingested. For durable re-ingest jobs set workerDefaults.forceReingest (see ingestion-relabel-runbook §4).',
		surreal: {
			rpc_url: rpcUrl,
			namespace: SURREAL_NAMESPACE(),
			database: SURREAL_DATABASE(),
			filter_status: status
		},
		row_count: rows.length,
		unique_url_count: urlLines.length,
		rows
	};

	fs.mkdirSync(path.dirname(jsonAbs), { recursive: true });
	fs.writeFileSync(jsonAbs, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
	const urlsAbs = path.resolve(urlsPath);
	fs.mkdirSync(path.dirname(urlsAbs), { recursive: true });
	fs.writeFileSync(urlsAbs, urlLines.join('\n') + (urlLines.length ? '\n' : ''), 'utf-8');
	console.log(`[relabel] sep-reingest-list: ${rows.length} row(s), ${urlLines.length} unique URL(s)`);
	console.log(`[relabel] wrote ${jsonAbs}`);
	console.log(`[relabel] wrote ${urlsAbs}`);
}

/** Strings that may equal `ingest_runs.source_url` for the same logical source (trim, raw, canonicalized). */
function urlMatchVariants(row: RelabelInventoryRow): string[] {
	const out: string[] = [];
	const add = (s: string | null | undefined) => {
		const t = (s ?? '').trim();
		if (t) out.push(t);
	};
	add(row.url);
	add(row.canonical_url);
	const c1 = canonicalizeSourceUrl(row.url ?? '');
	if (c1) out.push(c1);
	const c2 = canonicalizeSourceUrl(row.canonical_url ?? '');
	if (c2) out.push(c2);
	return [...new Set(out)];
}

function loadInventoryRows(fromPath: string): RelabelInventoryRow[] {
	const abs = path.isAbsolute(fromPath) ? fromPath : path.join(process.cwd(), fromPath);
	const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as { rows?: RelabelInventoryRow[] };
	if (!Array.isArray(raw.rows)) {
		throw new Error(`Expected { rows: [...] } in ${abs} (run inventory first)`);
	}
	return raw.rows;
}

async function cmdTrainingSidecar(argv: string[]): Promise<void> {
	const flags = parseArgs(argv);
	const from = typeof flags.from === 'string' ? flags.from : DEFAULT_INVENTORY_JSON;
	const outPath = typeof flags.out === 'string' ? flags.out : DEFAULT_SIDECAR;
	const rows = loadInventoryRows(from);
	const sidecar = {
		generated_at: new Date().toISOString(),
		generated_by: 'scripts/relabel-programme.ts training-sidecar',
		manifest_version: 1,
		note: 'Fill relabel_completed_at (ISO-8601) and extraction_model after each source is re-ingested with Mistral extraction.',
		row_count: rows.length,
		rows: rows.map((r) => ({
			source_id: r.source_id,
			canonical_url_hash: r.canonical_url_hash,
			url: r.url,
			relabel_completed_at: null as string | null,
			extraction_model: null as string | null
		}))
	};
	fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(sidecar, null, 2) + '\n', 'utf-8');
	console.log(`[relabel] wrote ${outPath} (${rows.length} template rows)`);
}

async function cmdNeonMap(argv: string[]): Promise<void> {
	loadServerEnv();
	const flags = parseArgs(argv);
	const from = typeof flags.from === 'string' ? flags.from : DEFAULT_INVENTORY_JSON;
	const outPath = typeof flags.out === 'string' ? flags.out : DEFAULT_NEON_MAP;
	if (!process.env.DATABASE_URL?.trim()) {
		console.error('DATABASE_URL is required for neon-map.');
		process.exit(1);
	}
	const invRows = loadInventoryRows(from);
	const urlSet = new Set<string>();
	for (const r of invRows) {
		for (const v of urlMatchVariants(r)) urlSet.add(v);
	}
	const urls = [...urlSet];
	if (urls.length === 0) {
		console.error('No usable URLs in inventory (url/canonical_url empty after trim).');
		process.exit(1);
	}
	const db = getDrizzleDb();
	const merged: {
		source_url: string;
		run_id: string | null;
		completed_at: string | null;
		extraction_model: string | null;
	}[] = [];

	for (const part of chunk(urls, 200)) {
		const result = await db.execute(sql`
      SELECT DISTINCT ON (ir.source_url)
        ir.source_url AS source_url,
        ir.id AS run_id,
        ir.completed_at AS completed_at,
        (ir.report_envelope::jsonb -> 'timingTelemetry' -> 'stage_models' ->> 'extraction') AS extraction_model
      FROM ${ingestRuns} ir
      WHERE ir.status = 'done'
        AND ir.cancelled_by_user = false
        AND ir.completed_at IS NOT NULL
        AND ir.source_url IN (${sql.join(part.map((u) => sql`${u}`), sql`, `)})
      ORDER BY ir.source_url, ir.completed_at DESC NULLS LAST
    `);
		const rows = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
		for (const row of rows) {
			merged.push({
				source_url: String(row.source_url ?? ''),
				run_id: row.run_id != null ? String(row.run_id) : null,
				completed_at: row.completed_at != null ? String(row.completed_at) : null,
				extraction_model: row.extraction_model != null ? String(row.extraction_model) : null
			});
		}
	}

	const byUrl = new Map(merged.map((r) => [r.source_url, r]));

	function neonHitForRow(r: RelabelInventoryRow): (typeof merged)[0] | undefined {
		for (const v of urlMatchVariants(r)) {
			const hit = byUrl.get(v);
			if (hit) return hit;
		}
		return undefined;
	}

	const enriched = invRows.map((r) => {
		const hit = neonHitForRow(r);
		const hasNeon = Boolean(hit);
		// false = no done Neon run (pre-Neon Surreal, non-orchestrated, etc.) — default exclude from Neon-provenance training exports
		return {
			source_id: r.source_id,
			canonical_url_hash: r.canonical_url_hash,
			url: r.url,
			has_neon_completed_ingest: hasNeon,
			latest_done_run_id: hit?.run_id ?? null,
			latest_done_completed_at: hit?.completed_at ?? null,
			latest_done_extraction_model: hit?.extraction_model ?? null,
			matched_neon_source_url: hit?.source_url ?? null
		};
	});

	const mistralLike = (m: string | null | undefined) =>
		m != null && m.toLowerCase().startsWith('mistral/');

	const inventoryMatched = enriched.filter((e) => e.latest_done_run_id != null).length;
	const summary = {
		inventory_rows: invRows.length,
		distinct_url_strings_for_neon_query: urls.length,
		neon_distinct_source_urls_with_done_run: merged.length,
		inventory_rows_matched_to_neon: inventoryMatched,
		inventory_rows_unmatched: invRows.length - inventoryMatched,
		mistral_extraction_hits_on_inventory: enriched.filter((e) => mistralLike(e.latest_done_extraction_model))
			.length,
		non_mistral_or_null_on_inventory: enriched.filter((e) => e.latest_done_run_id && !mistralLike(e.latest_done_extraction_model))
			.length,
		training_export_note:
			'Default fine-tune / supervision corpora that require Neon provenance: include only rows where has_neon_completed_ingest is true. Unmatched rows are often pre-Neon Surreal ingests, non-SEP / legacy paths, or URLs never run through orchestrated ingest — out of scope unless you re-orchestrate and adopt new envelopes.'
	};

	const doc = {
		generated_at: new Date().toISOString(),
		generated_by: 'scripts/relabel-programme.ts neon-map',
		summary,
		rows: enriched
	};
	fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
	console.log(`[relabel] wrote ${outPath}`);
	console.log(`[relabel] summary: ${JSON.stringify(summary)}`);
	if (inventoryMatched < invRows.length) {
		console.log(
			`[relabel] ${invRows.length - inventoryMatched} inventory row(s) have no Neon done run — typically pre-Neon or non-orchestrated Surreal sources; default excluded from Neon-backed training manifests (see summary.training_export_note).`
		);
	}
}

function printHelp(): void {
	console.log(`relabel-programme.ts

inventory   Export Surreal source rows for relabel control plane (JSON + CSV by default).
  --out-dir=DIR   default data/
  --status=STATUS ingested|validated|quarantined|pending|all (default all)
  --limit=N       cap rows (optional)
  --format=both|json|csv

training-sidecar   Emit training export sidecar template (M9.19) from inventory JSON.
  --from=PATH     default data/relabel-inventory.json
  --out=PATH      default data/training-relabel-sidecar.json

neon-map   Map each inventory URL to latest done Neon ingest run extraction model (M9.18 helper).
  --from=PATH     default data/relabel-inventory.json
  --out=PATH      default data/relabel-neon-extraction-by-url.json

sep-reingest-list   SEP-shaped rows in Surreal (for Approach A URL lists). Writes JSON + one URL per line.
  --out-dir=DIR   default data/ (writes sep-reingest-sources.json + sep-reingest-sources-urls.txt)
  --out=PATH      JSON path (default under --out-dir); URL list defaults to same stem + "-urls.txt"
  --urls-out=PATH override URL list path
  --status=STATUS default ingested (same values as inventory; use all for every SEP-shaped row)
`);
}

async function main(): Promise<void> {
	const [, , cmd, ...rest] = process.argv;
	if (!cmd || cmd === '-h' || cmd === '--help') {
		printHelp();
		process.exit(cmd ? 0 : 1);
	}
	try {
		if (cmd === 'inventory') {
			await cmdInventory(rest);
			return;
		}
		if (cmd === 'training-sidecar') {
			await cmdTrainingSidecar(rest);
			return;
		}
		if (cmd === 'neon-map') {
			await cmdNeonMap(rest);
			return;
		}
		if (cmd === 'sep-reingest-list') {
			await cmdSepReingestList(rest);
			return;
		}
		console.error(`Unknown command: ${cmd}`);
		printHelp();
		process.exit(1);
	} catch (e) {
		console.error('[relabel]', e instanceof Error ? e.message : String(e));
		process.exit(1);
	}
}

void main();
