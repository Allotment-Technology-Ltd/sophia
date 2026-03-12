/**
 * SOPHIA — Extraction Quality Report
 *
 * Generates a quality report after ingestion for manual review.
 *
 * Run with: npx tsx --env-file=.env scripts/quality-report.ts [--source <url>] [--all]
 */

import * as fs from 'fs';
import * as path from 'path';
import { Surreal } from 'surrealdb';
import { sourceIdentityFromUrl } from './source-identity.js';

// ─── Configuration ─────────────────────────────────────────────────────────
const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const REPORTS_DIR = './data/reports';

const RELATION_TABLES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'defines',
	'qualifies',
	'refines',
	'exemplifies'
] as const;
type RelationType = (typeof RELATION_TABLES)[number];

// ─── Types ─────────────────────────────────────────────────────────────────
interface SourceRecord {
	id: string;
	title: string;
	author: string[];
	year: number | null;
	source_type: string;
	url: string | null;
}

interface ClaimRecord {
	id: string;
	text: string;
	claim_type: string;
	domain: string;
	confidence: number;
	validation_score: number | null;
	embedding: number[] | null;
}

interface RelationEdge {
	in: string;
	out: string;
}

interface ArgumentRecord {
	id: string;
	name: string;
	summary: string;
}

interface PartOfRecord {
	in: string;
	out: string;
	role: string;
}

interface IngestionLogRecord {
	validation_score: number | null;
	cost_usd: number | null;
	status: string;
	claims_extracted: number | null;
}

interface SourceData {
	source: SourceRecord;
	claims: ClaimRecord[];
	relations: Map<RelationType, RelationEdge[]>;
	args: ArgumentRecord[];
	partOf: PartOfRecord[];
	log: IngestionLogRecord | null;
}

function normalizeRecordId(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (!value || typeof value !== 'object') return null;

	const record = value as { tb?: unknown; id?: unknown };
	if (typeof record.tb === 'string' && record.id !== undefined) {
		return `${record.tb}:${String(record.id)}`;
	}
	if (typeof record.id === 'string') {
		return record.id;
	}

	const rendered = String(value);
	return rendered && rendered !== '[object Object]' ? rendered : null;
}

// ─── DB Helpers ─────────────────────────────────────────────────────────────
async function connectDB(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

async function getSourceByUrl(db: Surreal, url: string): Promise<SourceRecord | null> {
	const result = await db.query<SourceRecord[][]>(
		'SELECT id, title, author, year, source_type, url FROM source WHERE url = $url LIMIT 1',
		{ url }
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	return rows.length > 0 ? rows[0] : null;
}

async function getAllSources(db: Surreal): Promise<SourceRecord[]> {
	const result = await db.query<SourceRecord[][]>(
		'SELECT id, title, author, year, source_type, url FROM source ORDER BY title'
	);
	return Array.isArray(result?.[0]) ? result[0] : [];
}

async function getClaimsForSource(db: Surreal, sourceId: string): Promise<ClaimRecord[]> {
	const result = await db.query<ClaimRecord[][]>(
		'SELECT id, text, claim_type, domain, confidence, validation_score, embedding FROM claim WHERE source = $source_id',
		{ source_id: sourceId }
	);
	return Array.isArray(result?.[0]) ? result[0] : [];
}

async function getRelationsForClaims(
	db: Surreal,
	claimIds: string[]
): Promise<Map<RelationType, RelationEdge[]>> {
	const map = new Map<RelationType, RelationEdge[]>();

	if (claimIds.length === 0) {
		for (const table of RELATION_TABLES) map.set(table, []);
		return map;
	}

	for (const table of RELATION_TABLES) {
		try {
			const result = await db.query<RelationEdge[][]>(
				`SELECT in, out FROM ${table} WHERE in INSIDE $ids OR out INSIDE $ids`,
				{ ids: claimIds }
			);
			const rows = Array.isArray(result?.[0]) ? result[0] : [];
			map.set(
				table,
				rows
					.map((row) => ({
						in: normalizeRecordId(row.in),
						out: normalizeRecordId(row.out)
					}))
					.filter((row): row is RelationEdge => Boolean(row.in && row.out))
			);
		} catch {
			map.set(table, []);
		}
	}

	return map;
}

async function getArgumentsForSource(db: Surreal, sourceId: string): Promise<ArgumentRecord[]> {
	const result = await db.query<ArgumentRecord[][]>(
		'SELECT id, name, summary FROM argument WHERE source = $source_id',
		{ source_id: sourceId }
	);
	return Array.isArray(result?.[0]) ? result[0] : [];
}

async function getPartOfForClaims(db: Surreal, claimIds: string[]): Promise<PartOfRecord[]> {
	if (claimIds.length === 0) return [];
	const result = await db.query<PartOfRecord[][]>(
		'SELECT in, out, role FROM part_of WHERE in INSIDE $ids',
		{ ids: claimIds }
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	return rows
		.map((row) => ({
			in: normalizeRecordId(row.in),
			out: normalizeRecordId(row.out),
			role: row.role
		}))
		.filter((row): row is PartOfRecord => Boolean(row.in && row.out && row.role));
}

async function getIngestionLog(
	db: Surreal,
	url: string
): Promise<IngestionLogRecord | null> {
	const hash = sourceIdentityFromUrl(url).canonicalUrlHash;
	const result = await db.query<IngestionLogRecord[][]>(
		'SELECT validation_score, cost_usd, status, claims_extracted FROM ingestion_log WHERE canonical_url_hash = $hash OR source_url = $url LIMIT 1',
		{ hash, url }
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	return rows.length > 0 ? rows[0] : null;
}

// ─── Analysis ───────────────────────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

interface DuplicatePair {
	a: ClaimRecord;
	b: ClaimRecord;
	similarity: number;
}

function findNearDuplicates(claims: ClaimRecord[], threshold = 0.9): DuplicatePair[] {
	const withEmb = claims.filter((c) => c.embedding && c.embedding.length > 0);
	const pairs: DuplicatePair[] = [];

	for (let i = 0; i < withEmb.length; i++) {
		for (let j = i + 1; j < withEmb.length; j++) {
			const sim = cosineSimilarity(withEmb[i].embedding!, withEmb[j].embedding!);
			if (sim >= threshold) {
				pairs.push({ a: withEmb[i], b: withEmb[j], similarity: sim });
			}
		}
	}

	return pairs.sort((a, b) => b.similarity - a.similarity);
}

function detectOrphans(
	claims: ClaimRecord[],
	relations: Map<RelationType, RelationEdge[]>,
	partOf: PartOfRecord[]
): ClaimRecord[] {
	const connectedIds = new Set<string>();

	for (const edges of Array.from(relations.values())) {
		for (const edge of edges) {
			connectedIds.add(edge.in);
			connectedIds.add(edge.out);
		}
	}
	for (const po of partOf) connectedIds.add(po.in);

	return claims.filter((c) => {
		const claimId = normalizeRecordId(c.id);
		return !claimId || !connectedIds.has(claimId);
	});
}

function countByKey<T>(items: T[], key: keyof T): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const item of items) {
		const val = String(item[key]);
		counts[val] = (counts[val] ?? 0) + 1;
	}
	return counts;
}

function sampleRandom<T>(arr: T[], n: number): T[] {
	const copy = [...arr];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy.slice(0, n);
}

// ─── Report Formatting ───────────────────────────────────────────────────────
function trunc(text: string, maxLen = 120): string {
	return text.length > maxLen ? text.substring(0, maxLen - 3) + '...' : text;
}

function formatSourceSection(data: SourceData): string {
	const { source, claims, relations, args, partOf, log } = data;
	const lines: string[] = [];

	// ── Header ──────────────────────────────────────────────────────────────
	lines.push(`## SOURCE: ${source.title}`);
	lines.push('');
	const authorStr = Array.isArray(source.author) && source.author.length > 0
		? source.author.join(', ')
		: 'Unknown';
	lines.push(`**Author:** ${authorStr} | **Year:** ${source.year ?? 'n/a'} | **Type:** ${source.source_type}`);
	if (source.url) lines.push(`**URL:** ${source.url}`);
	if (log) {
		lines.push(`**Ingestion status:** ${log.status}`);
		if (log.cost_usd != null) lines.push(`**Ingestion cost:** $${log.cost_usd.toFixed(4)}`);
		if (log.validation_score != null)
			lines.push(`**Validation score:** ${log.validation_score.toFixed(2)}`);
	}
	lines.push('');

	// ── Summary ─────────────────────────────────────────────────────────────
	const totalRelations = Array.from(relations.values()).reduce((s, e) => s + e.length, 0);
	lines.push('### Summary');
	lines.push('');
	lines.push('| Metric | Count |');
	lines.push('|--------|-------|');
	lines.push(`| Claims | ${claims.length} |`);
	lines.push(`| Relations | ${totalRelations} |`);
	lines.push(`| Arguments | ${args.length} |`);
	lines.push('');

	// Claims by type
	const claimsByType = countByKey(claims, 'claim_type');
	lines.push('#### Claims by Type');
	lines.push('');
	lines.push('| Type | Count |');
	lines.push('|------|-------|');
	for (const [type, count] of Object.entries(claimsByType).sort((a, b) => b[1] - a[1])) {
		lines.push(`| ${type} | ${count} |`);
	}
	lines.push('');

	// Relations by type
	lines.push('#### Relations by Type');
	lines.push('');
	lines.push('| Type | Count |');
	lines.push('|------|-------|');
	let anyRelations = false;
	for (const table of RELATION_TABLES) {
		const count = relations.get(table)?.length ?? 0;
		if (count > 0) {
			lines.push(`| ${table} | ${count} |`);
			anyRelations = true;
		}
	}
	if (!anyRelations) lines.push('| *none* | 0 |');
	lines.push('');

	// Arguments
	if (args.length > 0) {
		const claimsPerArg = new Map<string, number>();
		for (const po of partOf) claimsPerArg.set(po.out, (claimsPerArg.get(po.out) ?? 0) + 1);

		lines.push('#### Arguments');
		lines.push('');
		for (const arg of args) {
			const count = claimsPerArg.get(normalizeRecordId(arg.id) ?? '') ?? 0;
			lines.push(`- **${arg.name}** (${count} claim${count === 1 ? '' : 's'})`);
			lines.push(`  *${arg.summary}*`);
		}
		lines.push('');
	}

	// ── Quality Indicators ───────────────────────────────────────────────────
	lines.push('### Quality Indicators');
	lines.push('');

	// 1. Low confidence
	const lowConf = claims.filter((c) => c.confidence < 0.7);
	if (lowConf.length > 0) {
		lines.push(`#### ⚠ Low-Confidence Claims (< 0.7) — ${lowConf.length} found`);
		lines.push('');
		for (const c of lowConf.slice(0, 10)) {
			lines.push(`- confidence **${c.confidence.toFixed(2)}** | *${trunc(c.text)}*`);
		}
		if (lowConf.length > 10) lines.push(`- *(${lowConf.length - 10} more not shown)*`);
	} else {
		lines.push('#### ✓ Low-Confidence Claims — None');
	}
	lines.push('');

	// 2. Thin arguments
	const claimsPerArg = new Map<string, number>();
	for (const po of partOf) claimsPerArg.set(po.out, (claimsPerArg.get(po.out) ?? 0) + 1);
	const thinArgs = args.filter((a) => (claimsPerArg.get(normalizeRecordId(a.id) ?? '') ?? 0) <= 2);
	if (thinArgs.length > 0) {
		lines.push(`#### ⚠ Thin Arguments (≤ 2 claims) — ${thinArgs.length} found`);
		lines.push('');
		for (const a of thinArgs) {
			const n = claimsPerArg.get(normalizeRecordId(a.id) ?? '') ?? 0;
			lines.push(`- **${a.name}** (${n} claim${n === 1 ? '' : 's'})`);
		}
	} else if (args.length > 0) {
		lines.push('#### ✓ Thin Arguments — None');
	}
	lines.push('');

	// 3. Orphan claims
	const orphans = detectOrphans(claims, relations, partOf);
	if (orphans.length > 0) {
		const pct = claims.length > 0 ? ((orphans.length / claims.length) * 100).toFixed(0) : '0';
		lines.push(`#### ⚠ Orphan Claims (no relations, not in any argument) — ${orphans.length} (${pct}%)`);
		lines.push('');
		for (const c of orphans.slice(0, 10)) {
			lines.push(`- *${trunc(c.text)}*`);
		}
		if (orphans.length > 10) lines.push(`- *(${orphans.length - 10} more not shown)*`);
	} else {
		lines.push('#### ✓ Orphan Claims — None');
	}
	lines.push('');

	// 4. Relation imbalance
	const supportsN = relations.get('supports')?.length ?? 0;
	const contradictsN = relations.get('contradicts')?.length ?? 0;
	if (totalRelations > 0) {
		const suppPct = (supportsN / totalRelations) * 100;
		const contPct = (contradictsN / totalRelations) * 100;
		if (suppPct > 80 && contPct < 10) {
			lines.push(`#### ⚠ Relation Imbalance — ${suppPct.toFixed(0)}% supports, ${contPct.toFixed(0)}% contradicts`);
			lines.push('');
			lines.push('> Extraction may be missing objections and contradictions.');
		} else {
			lines.push(`#### ✓ Relation Balance — supports: ${suppPct.toFixed(0)}%, contradicts: ${contPct.toFixed(0)}%`);
		}
		lines.push('');
	}

	// 5. Near-duplicate claims
	const dupes = findNearDuplicates(claims);
	if (dupes.length > 0) {
		lines.push(`#### ⚠ Potential Duplicate Claims (cosine > 0.9) — ${dupes.length} pair(s)`);
		lines.push('');
		for (const d of dupes.slice(0, 5)) {
			lines.push(`- **similarity: ${(d.similarity * 100).toFixed(1)}%**`);
			lines.push(`  A: *${trunc(d.a.text, 100)}*`);
			lines.push(`  B: *${trunc(d.b.text, 100)}*`);
		}
		if (dupes.length > 5) lines.push(`- *(${dupes.length - 5} more pairs not shown)*`);
	} else {
		lines.push('#### ✓ Potential Duplicates — None');
	}
	lines.push('');

	// ── Sample Claims ────────────────────────────────────────────────────────
	lines.push('### Sample Claims for Spot-Check');
	lines.push('');

	if (claims.length === 0) {
		lines.push('*No claims found.*');
		lines.push('');
	} else {
		// Build lookup structures
		const claimSet = new Set(claims.map((c) => c.id));
		const claimMap = new Map(claims.map((c) => [c.id, c]));
		const argMap = new Map(args.map((a) => [a.id, a]));

		type RelEntry = { type: RelationType; direction: 'out' | 'in'; otherId: string };
		const relsByClaim = new Map<string, RelEntry[]>(claims.map((c) => [c.id, []]));
		for (const [relType, edges] of Array.from(relations.entries())) {
			for (const edge of edges) {
				if (claimSet.has(edge.in))
					relsByClaim.get(edge.in)!.push({ type: relType, direction: 'out', otherId: edge.out });
				if (claimSet.has(edge.out))
					relsByClaim.get(edge.out)!.push({ type: relType, direction: 'in', otherId: edge.in });
			}
		}

		const argsByClaim = new Map<string, Array<{ arg: ArgumentRecord; role: string }>>(
			claims.map((c) => [c.id, []])
		);
		for (const po of partOf) {
			if (claimSet.has(po.in)) {
				const arg = argMap.get(po.out);
				if (arg) argsByClaim.get(po.in)!.push({ arg, role: po.role });
			}
		}

		const sample = sampleRandom(claims, Math.min(5, claims.length));
		for (let i = 0; i < sample.length; i++) {
			const c = sample[i];
			lines.push(`#### Claim ${i + 1} *(${c.claim_type}, confidence: ${c.confidence.toFixed(2)})*`);
			lines.push('');
			lines.push(`> ${c.text}`);
			lines.push('');

			const rels = relsByClaim.get(c.id) ?? [];
			if (rels.length > 0) {
				lines.push('**Relations:**');
				for (const r of rels.slice(0, 5)) {
					const other = claimMap.get(r.otherId);
					const otherText = other ? trunc(other.text, 80) : `[external: ${r.otherId}]`;
					const arrow = r.direction === 'out' ? '→' : '←';
					lines.push(`- ${arrow} \`${r.type}\` *${otherText}*`);
				}
				if (rels.length > 5) lines.push(`- *(${rels.length - 5} more relations)*`);
			} else {
				lines.push('**Relations:** *none*');
			}
			lines.push('');

			const argMemberships = argsByClaim.get(c.id) ?? [];
			if (argMemberships.length > 0) {
				lines.push('**Arguments:**');
				for (const m of argMemberships) {
					lines.push(`- \`${m.role}\` in **${m.arg.name}**`);
				}
			} else {
				lines.push('**Arguments:** *none*');
			}
			lines.push('');
		}
	}

	lines.push('---');
	lines.push('');
	return lines.join('\n');
}

function formatCrossSourceSummary(allData: SourceData[]): string {
	const lines: string[] = [];

	lines.push('## Cross-Source Summary');
	lines.push('');

	const totalClaims = allData.reduce((s, d) => s + d.claims.length, 0);
	const totalRelations = allData.reduce(
		(s, d) => s + Array.from(d.relations.values()).reduce((r, e) => r + e.length, 0),
		0
	);
	const totalArgs = allData.reduce((s, d) => s + d.args.length, 0);
	const claimCounts = allData.map((d) => d.claims.length);

	lines.push('| Metric | Value |');
	lines.push('|--------|-------|');
	lines.push(`| Total sources | ${allData.length} |`);
	lines.push(`| Total claims | ${totalClaims} |`);
	lines.push(`| Total relations | ${totalRelations} |`);
	lines.push(`| Total arguments | ${totalArgs} |`);
	if (allData.length > 0) {
		lines.push(`| Claims/source — min | ${Math.min(...claimCounts)} |`);
		lines.push(`| Claims/source — max | ${Math.max(...claimCounts)} |`);
		lines.push(`| Claims/source — avg | ${(totalClaims / allData.length).toFixed(1)} |`);
	}
	lines.push('');

	// Domain distribution across all claims
	const domainCounts: Record<string, number> = {};
	for (const d of allData) {
		for (const c of d.claims) {
			if (c.domain) domainCounts[c.domain] = (domainCounts[c.domain] ?? 0) + 1;
		}
	}
	if (Object.keys(domainCounts).length > 0) {
		lines.push('#### Domain Distribution');
		lines.push('');
		lines.push('| Domain | Claims |');
		lines.push('|--------|--------|');
		for (const [domain, count] of Object.entries(domainCounts).sort((a, b) => b[1] - a[1])) {
			lines.push(`| ${domain} | ${count} |`);
		}
		lines.push('');
	}

	// Sources with lowest validation scores
	const withScores = allData
		.filter((d) => d.log?.validation_score != null)
		.map((d) => ({ title: d.source.title, score: d.log!.validation_score! }))
		.sort((a, b) => a.score - b.score);

	if (withScores.length > 0) {
		lines.push('#### Sources with Lowest Validation Scores');
		lines.push('');
		lines.push('| Source | Score |');
		lines.push('|--------|-------|');
		for (const { title, score } of withScores.slice(0, 5)) {
			lines.push(`| ${title} | ${score.toFixed(2)} |`);
		}
		lines.push('');
	}

	// Sources with most orphan claims
	const withOrphans = allData
		.map((d) => ({
			title: d.source.title,
			orphans: detectOrphans(d.claims, d.relations, d.partOf).length,
			total: d.claims.length
		}))
		.filter((d) => d.orphans > 0)
		.sort((a, b) => b.orphans - a.orphans);

	if (withOrphans.length > 0) {
		lines.push('#### Sources with Most Orphan Claims');
		lines.push('');
		lines.push('| Source | Orphans | Total Claims |');
		lines.push('|--------|---------|--------------|');
		for (const { title, orphans, total } of withOrphans.slice(0, 10)) {
			lines.push(`| ${title} | ${orphans} | ${total} |`);
		}
		lines.push('');
	}

	// Per-source breakdown
	lines.push('#### Claims per Source');
	lines.push('');
	lines.push('| Source | Claims | Relations | Arguments |');
	lines.push('|--------|--------|-----------|-----------|');
	for (const d of [...allData].sort((a, b) => b.claims.length - a.claims.length)) {
		const rels = Array.from(d.relations.values()).reduce((s, e) => s + e.length, 0);
		lines.push(`| ${d.source.title} | ${d.claims.length} | ${rels} | ${d.args.length} |`);
	}
	lines.push('');

	return lines.join('\n');
}

// ─── Output ──────────────────────────────────────────────────────────────────
class ReportWriter {
	private chunks: string[] = [];

	append(text: string): void {
		this.chunks.push(text);
		process.stdout.write(text);
	}

	getContent(): string {
		return this.chunks.join('');
	}
}

// ─── Fetch Helper ─────────────────────────────────────────────────────────────
async function fetchSourceData(db: Surreal, source: SourceRecord): Promise<SourceData> {
	const [claims, args, log] = await Promise.all([
		getClaimsForSource(db, source.id),
		getArgumentsForSource(db, source.id),
		source.url ? getIngestionLog(db, source.url) : Promise.resolve(null)
	]);

	const claimIds = claims.map((c) => c.id);
	const [relations, partOf] = await Promise.all([
		getRelationsForClaims(db, claimIds),
		getPartOfForClaims(db, claimIds)
	]);

	return { source, claims, relations, args, partOf, log };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
	const argv = process.argv.slice(2);
	let sourceUrl: string | null = null;
	let reportAll = false;

	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--source' && i + 1 < argv.length) {
			sourceUrl = argv[++i];
		} else if (argv[i] === '--all') {
			reportAll = true;
		}
	}

	if (!sourceUrl && !reportAll) {
		console.error(
			'Usage: npx tsx --env-file=.env scripts/quality-report.ts [--source <url>] [--all]'
		);
		process.exit(1);
	}

	console.error('[REPORT] Connecting to SurrealDB...');
	const db = await connectDB();
	console.error('[REPORT] Connected\n');

	const timestamp = new Date().toISOString();
	const writer = new ReportWriter();

	writer.append(`# SOPHIA — Quality Report\n\nGenerated: ${timestamp}\n\n---\n\n`);

	if (sourceUrl) {
		const source = await getSourceByUrl(db, sourceUrl);
		if (!source) {
			console.error(`[ERROR] Source not found with URL: ${sourceUrl}`);
			await db.close();
			process.exit(1);
		}
		console.error(`[REPORT] Analysing: ${source.title}...`);
		const data = await fetchSourceData(db, source);
		writer.append(formatSourceSection(data));
	} else {
		const sources = await getAllSources(db);
		console.error(`[REPORT] Found ${sources.length} sources\n`);

		const allData: SourceData[] = [];
		for (const source of sources) {
			console.error(`[REPORT] Analysing: ${source.title}...`);
			const data = await fetchSourceData(db, source);
			allData.push(data);
			writer.append(formatSourceSection(data));
		}

		writer.append(formatCrossSourceSummary(allData));
	}

	// Save to file
	if (!fs.existsSync(REPORTS_DIR)) {
		fs.mkdirSync(REPORTS_DIR, { recursive: true });
	}

	const fileTs = timestamp.replace(/[:.]/g, '-').substring(0, 19);
	const filePath = path.join(REPORTS_DIR, `quality-report-${fileTs}.md`);
	fs.writeFileSync(filePath, writer.getContent(), 'utf-8');

	console.error(`\n[REPORT] ✓ Saved to: ${filePath}`);

	await db.close();
}

main().catch((err) => {
	console.error('[ERROR]', err instanceof Error ? err.message : err);
	process.exit(1);
});
