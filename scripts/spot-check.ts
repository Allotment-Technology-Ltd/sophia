/**
 * SOPHIA — Spot-Check Helper
 *
 * Interactive tool for manually reviewing extracted claims against source text.
 *
 * Usage: npx tsx --env-file=.env scripts/spot-check.ts <source-url> [--count N]
 *
 *   --count N   Number of claims to review (default: 10)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Surreal } from 'surrealdb';
import { canonicalizeAndHashSourceUrl } from '../src/lib/server/sourceIdentity.js';

// ─── Configuration ─────────────────────────────────────────────────────────
const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';

const SOURCES_DIR = './data/sources';
const REPORTS_DIR = './data/reports';
const CONTEXT_WINDOW = 500;

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
	url: string | null;
}

interface ClaimRecord {
	id: string;
	text: string;
	claim_type: string;
	confidence: number;
	section_context: string | null;
	position_in_source: number | null;
}

interface RelationEdge {
	in: string;
	out: string;
}

interface ArgumentRecord {
	id: string;
	name: string;
}

interface PartOfRecord {
	in: string;
	out: string;
	role: string;
}

type Rating = 'accurate' | 'partial' | 'inaccurate' | 'skipped';

interface SpotCheckEntry {
	index: number;
	claim_id: string;
	claim_text: string;
	claim_type: string;
	confidence: number;
	position_in_source: number | null;
	rating: Rating;
	note?: string;
}

interface SpotCheckReport {
	source_url: string;
	source_title: string;
	timestamp: string;
	total_claims_in_source: number;
	total_checked: number;
	ratings: { accurate: number; partial: number; inaccurate: number; skipped: number };
	entries: SpotCheckEntry[];
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
		'SELECT id, title, url FROM source WHERE url = $url LIMIT 1',
		{ url }
	);
	const rows = Array.isArray(result?.[0]) ? result[0] : [];
	return rows.length > 0 ? rows[0] : null;
}

async function getClaimsForSource(db: Surreal, sourceId: string): Promise<ClaimRecord[]> {
	const result = await db.query<ClaimRecord[][]>(
		`SELECT id, text, claim_type, confidence, section_context, position_in_source
		 FROM claim WHERE source = $source_id ORDER BY position_in_source`,
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
		for (const t of RELATION_TABLES) map.set(t, []);
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
		'SELECT id, name FROM argument WHERE source = $source_id',
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

// ─── Source Text Helpers ─────────────────────────────────────────────────────
function createSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.substring(0, 50);
}

function findSlugForUrl(url: string): string | null {
	const targetIdentity = canonicalizeAndHashSourceUrl(url);
	if (!targetIdentity) return null;
	if (!fs.existsSync(SOURCES_DIR)) return null;
	for (const file of fs.readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.meta.json'))) {
		try {
			const meta = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, file), 'utf-8')) as {
				url?: string;
				canonical_url?: string;
			};
			const metaIdentity = canonicalizeAndHashSourceUrl(meta.canonical_url || meta.url || '');
			if (metaIdentity?.canonicalUrlHash === targetIdentity.canonicalUrlHash) {
				return file.replace('.meta.json', '');
			}
		} catch {
			/* skip corrupt files */
		}
	}
	return null;
}

interface ContextResult {
	text: string;
	label: string;
}

function findSourceContext(
	sourceText: string,
	sectionContext: string | null,
	posInSource: number | null,
	totalClaims: number
): ContextResult {
	if (sectionContext) {
		const lower = sourceText.toLowerCase();
		const needle = sectionContext.toLowerCase().trim();

		// Full match
		let idx = lower.indexOf(needle);

		// Partial match on first 40 chars if full not found
		if (idx === -1 && needle.length > 10) {
			idx = lower.indexOf(needle.substring(0, 40));
		}

		if (idx !== -1) {
			return {
				text: sourceText.substring(idx, idx + CONTEXT_WINDOW),
				label: `Section: "${sectionContext}"`
			};
		}
	}

	if (posInSource != null && totalClaims > 1) {
		const fraction = (posInSource - 1) / (totalClaims - 1);
		const start = Math.floor(fraction * Math.max(0, sourceText.length - CONTEXT_WINDOW));
		const pct = Math.round(fraction * 100);
		return {
			text: sourceText.substring(start, start + CONTEXT_WINDOW),
			label: `~${pct}% through source (estimated from position ${posInSource}/${totalClaims})`
		};
	}

	return {
		text: sourceText.substring(0, CONTEXT_WINDOW),
		label: 'start of source'
	};
}

// ─── Display ─────────────────────────────────────────────────────────────────
const WIDE = '═'.repeat(55);
const THIN = '─'.repeat(55);

function truncate(text: string, max: number): string {
	return text.length > max ? text.substring(0, max - 3) + '...' : text;
}

function renderClaim(
	claim: ClaimRecord,
	idx: number,
	total: number,
	claimMap: Map<string, ClaimRecord>,
	relations: Map<RelationType, RelationEdge[]>,
	argMap: Map<string, ArgumentRecord>,
	partOf: PartOfRecord[],
	sourceText: string,
	totalClaims: number
): void {
	const claimId = normalizeRecordId(claim.id) ?? String(claim.id);
	const pos = claim.position_in_source ?? '?';
	console.log(`\n${WIDE}`);
	console.log(
		`CLAIM ${idx + 1}/${total}  (position: ${pos}, type: ${claim.claim_type}, confidence: ${claim.confidence.toFixed(2)})`
	);
	console.log(WIDE);

	console.log('\nEXTRACTED CLAIM:');
	console.log(`"${claim.text}"`);

	// Relations
	type RelEntry = { type: RelationType; dir: 'out' | 'in'; otherId: string };
	const claimRels: RelEntry[] = [];
	for (const [relType, edges] of Array.from(relations.entries())) {
		for (const edge of edges) {
			if (edge.in === claimId) claimRels.push({ type: relType, dir: 'out', otherId: edge.out });
			if (edge.out === claimId) claimRels.push({ type: relType, dir: 'in', otherId: edge.in });
		}
	}

	if (claimRels.length > 0) {
		console.log('\nRELATIONS:');
		for (const r of claimRels.slice(0, 8)) {
			const other = claimMap.get(r.otherId);
			const otherPos = other?.position_in_source;
			const posLabel = otherPos != null ? `claim ${otherPos}: ` : '';
			const otherText = other
				? `"${truncate(other.text, 70)}"`
				: `[external: ${r.otherId}]`;
			const arrow = r.dir === 'out' ? '→' : '←';
			console.log(`  • ${r.type} ${arrow} ${posLabel}${otherText}`);
		}
		if (claimRels.length > 8) console.log(`  • (${claimRels.length - 8} more)`);
	} else {
		console.log('\nRELATIONS: (none)');
	}

	// Argument membership
	const memberships = partOf.filter((po) => po.in === claimId);
	if (memberships.length > 0) {
		console.log('\nARGUMENT MEMBERSHIP:');
		for (const m of memberships) {
			const arg = argMap.get(m.out);
			if (arg) console.log(`  • "${arg.name}" (role: ${m.role})`);
		}
	} else {
		console.log('\nARGUMENT MEMBERSHIP: (none)');
	}

	// Source context
	if (sourceText) {
		const ctx = findSourceContext(
			sourceText,
			claim.section_context,
			claim.position_in_source,
			totalClaims
		);
		console.log(`\nSOURCE CONTEXT (${ctx.label}):`);
		console.log(THIN);
		console.log(ctx.text.trim());
		console.log(THIN);
	} else {
		console.log('\nSOURCE CONTEXT: (source text not available locally)');
	}
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function sampleRandom<T>(arr: T[], n: number): T[] {
	const copy = [...arr];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy.slice(0, n);
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => resolve(answer.trim().toLowerCase()));
	});
}

// ─── Summary + Save ──────────────────────────────────────────────────────────
function saveAndSummarize(
	entries: SpotCheckEntry[],
	sourceTitle: string,
	sourceUrl: string,
	totalClaimsInSource: number
): void {
	if (entries.length === 0) {
		console.log('\n(No claims rated — nothing to save.)');
		return;
	}

	const ratings = {
		accurate: entries.filter((e) => e.rating === 'accurate').length,
		partial: entries.filter((e) => e.rating === 'partial').length,
		inaccurate: entries.filter((e) => e.rating === 'inaccurate').length,
		skipped: entries.filter((e) => e.rating === 'skipped').length
	};

	const rated = entries.length - ratings.skipped;

	const report: SpotCheckReport = {
		source_url: sourceUrl,
		source_title: sourceTitle,
		timestamp: new Date().toISOString(),
		total_claims_in_source: totalClaimsInSource,
		total_checked: entries.length,
		ratings,
		entries
	};

	// Save JSON
	if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

	const urlSlug = sourceUrl
		.replace(/https?:\/\//, '')
		.replace(/[^a-z0-9]+/gi, '-')
		.substring(0, 40)
		.replace(/^-|-$/g, '');
	const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
	const filePath = path.join(REPORTS_DIR, `spot-check-${urlSlug}-${ts}.json`);
	fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');

	// Print summary
	console.log(`\n${WIDE}`);
	console.log('SPOT-CHECK SUMMARY');
	console.log(WIDE);
	console.log('');
	console.log(`Source:           ${sourceTitle}`);
	console.log(`Claims reviewed:  ${entries.length} of ${totalClaimsInSource} total`);
	console.log('');

	if (rated > 0) {
		const accPct = Math.round((ratings.accurate / rated) * 100);
		const partPct = Math.round((ratings.partial / rated) * 100);
		const inaccPct = Math.round((ratings.inaccurate / rated) * 100);
		console.log(`Accurate:         ${ratings.accurate}/${rated} (${accPct}%)`);
		console.log(`Partially:        ${ratings.partial}/${rated} (${partPct}%)`);
		console.log(`Inaccurate:       ${ratings.inaccurate}/${rated} (${inaccPct}%)`);
		if (ratings.skipped > 0) console.log(`Skipped:          ${ratings.skipped}`);

		const inaccurateEntries = entries.filter((e) => e.rating === 'inaccurate');
		if (inaccurateEntries.length > 0) {
			console.log('\nClaims flagged as inaccurate:');
			for (const e of inaccurateEntries) {
				console.log(`  Claim ${e.index}: "${truncate(e.claim_text, 80)}"`);
				if (e.note) console.log(`    Note: ${e.note}`);
			}
		}

		console.log('');
		const accuracyRate = ratings.accurate / rated;
		if (accuracyRate < 0.8) {
			console.log(
				'⚠  WARNING: Extraction accuracy below 80% threshold.'
			);
			console.log(
				'   Consider re-running ingestion with tuned prompts.'
			);
			console.log(
				'   Check src/lib/server/prompts/extraction.ts for this source type.'
			);
		} else {
			console.log(`✓  Accuracy above threshold (${Math.round(accuracyRate * 100)}%)`);
		}
	} else {
		console.log('(All claims skipped — no accuracy data.)');
	}

	console.log('');
	console.log(`Report saved: ${filePath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
	const argv = process.argv.slice(2);

	let sourceUrl: string | null = null;
	let count = 10;

	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--count' && i + 1 < argv.length) {
			const n = parseInt(argv[++i], 10);
			if (!isNaN(n) && n > 0) count = n;
		} else if (!argv[i].startsWith('--')) {
			sourceUrl = argv[i];
		}
	}

	if (!sourceUrl) {
		console.error(
			'Usage: npx tsx --env-file=.env scripts/spot-check.ts <source-url> [--count N]'
		);
		process.exit(1);
	}

	// Connect and fetch all data before going interactive
	console.log('[SPOT-CHECK] Connecting to SurrealDB...');
	const db = await connectDB();

	const source = await getSourceByUrl(db, sourceUrl);
	if (!source) {
		console.error(`[ERROR] Source not found in DB: ${sourceUrl}`);
		await db.close();
		process.exit(1);
	}

	console.log(`[SPOT-CHECK] Source: ${source.title}`);
	console.log('[SPOT-CHECK] Fetching claims and relations...');

	const allClaims = await getClaimsForSource(db, source.id);

	if (allClaims.length === 0) {
		console.error('[ERROR] No claims found. Has this source been ingested?');
		await db.close();
		process.exit(1);
	}

	const claimIds = allClaims.map((c) => c.id);
	const [relations, args, partOf] = await Promise.all([
		getRelationsForClaims(db, claimIds),
		getArgumentsForSource(db, source.id),
		getPartOfForClaims(db, claimIds)
	]);

	await db.close();

	console.log(`[SPOT-CHECK] ${allClaims.length} claims, ${args.length} arguments loaded`);

	// Load source text
	const slug = findSlugForUrl(sourceUrl) ?? createSlug(source.title);
	const textPath = path.join(SOURCES_DIR, `${slug}.txt`);
	const sourceText = fs.existsSync(textPath) ? fs.readFileSync(textPath, 'utf-8') : '';
	if (sourceText) {
		console.log(`[SPOT-CHECK] Source text loaded (${sourceText.length.toLocaleString()} chars)`);
	} else {
		console.warn(`[WARN] Source text not found at ${textPath} — context display will be limited`);
	}

	// Build lookup maps
	const claimMap = new Map(
		allClaims.map((c) => [normalizeRecordId(c.id) ?? String(c.id), c])
	);
	const argMap = new Map(
		args.map((a) => [normalizeRecordId(a.id) ?? String(a.id), a])
	);

	// Sample
	const sampleSize = Math.min(count, allClaims.length);
	const sample = sampleRandom(allClaims, sampleSize);

	console.log('');
	console.log(`Reviewing ${sampleSize} of ${allClaims.length} claims from:`);
	console.log(`  ${source.title}`);
	console.log('');
	console.log('Ratings:  [a] Accurate  [p] Partially accurate  [i] Inaccurate  [s] Skip');

	// Set up readline
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false   // avoid echoing — readline question() handles its own output
	});

	const entries: SpotCheckEntry[] = [];

	// Graceful Ctrl+C: save whatever was rated so far
	process.on('SIGINT', () => {
		console.log('\n\n[Interrupted] Saving partial results...');
		rl.close();
		saveAndSummarize(entries, source.title, sourceUrl!, allClaims.length);
		process.exit(0);
	});

	// Interactive rating loop
	for (let i = 0; i < sample.length; i++) {
		const claim = sample[i];

		renderClaim(
			claim,
			i,
			sampleSize,
			claimMap,
			relations,
			argMap,
			partOf,
			sourceText,
			allClaims.length
		);

		console.log('\nRate this claim:');
		console.log('  [a] Accurate — faithfully represents the source');
		console.log('  [p] Partially accurate — mostly right but imprecise');
		console.log('  [i] Inaccurate — misrepresents or hallucinates');
		console.log('  [s] Skip');

		let rating: Rating | null = null;
		while (rating === null) {
			const input = await ask(rl, '> ');
			if (input === 'a') rating = 'accurate';
			else if (input === 'p') rating = 'partial';
			else if (input === 'i') rating = 'inaccurate';
			else if (input === 's') rating = 'skipped';
			else console.log('  Enter a, p, i, or s');
		}

		let note: string | undefined;
		if (rating === 'inaccurate') {
			const noteInput = await ask(rl, 'Note (optional — press Enter to skip): ');
			if (noteInput) note = noteInput;
		}

		entries.push({
			index: i + 1,
			claim_id: normalizeRecordId(claim.id) ?? String(claim.id),
			claim_text: claim.text,
			claim_type: claim.claim_type,
			confidence: claim.confidence,
			position_in_source: claim.position_in_source,
			rating,
			note
		});

		console.log(`  ✓ ${rating}`);
	}

	rl.close();
	saveAndSummarize(entries, source.title, sourceUrl!, allClaims.length);
}

main().catch((err) => {
	console.error('[ERROR]', err instanceof Error ? err.message : err);
	process.exit(1);
});
