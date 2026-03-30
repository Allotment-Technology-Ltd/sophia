import { Surreal } from 'surrealdb';
import { startSpinner, startStageTimer } from './progress.js';

const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';
const LOW_CONFIDENCE_REVIEW_THRESHOLD = Number(
	process.env.INGEST_LOW_CONFIDENCE_REVIEW_THRESHOLD || '0.65'
);
const BACKFILL_EXTRACTOR_VERSION = 'relation-backfill-v1';

const RELATION_TABLES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'refines',
	'exemplifies'
] as const;

type RelationTable = (typeof RELATION_TABLES)[number];

type RelationRow = {
	id: unknown;
	in?: unknown;
	out?: unknown;
	strength?: unknown;
	necessity?: unknown;
	response_type?: unknown;
	refinement_type?: unknown;
	relation_confidence?: unknown;
	relation_inference_mode?: unknown;
	verification_state?: unknown;
	review_state?: unknown;
	extractor_version?: unknown;
	evidence_passages?: unknown;
};

type ClaimPassageRow = {
	id: unknown;
	passage?: unknown;
	passage_id?: unknown;
};

type TableSummary = {
	totalRows: number;
	updatedRows: number;
	alreadyComplete: number;
};

function parseArgs(argv: string[]) {
	return {
		dryRun: argv.includes('--dry-run')
	};
}

function normalizeRecordId(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (!value || typeof value !== 'object') return null;
	const record = value as { tb?: unknown; id?: unknown };
	if (typeof record.tb === 'string' && record.id !== undefined) {
		return `${record.tb}:${String(record.id)}`;
	}
	if (typeof record.id === 'string') return record.id;
	return null;
}

function isMissing(value: unknown): boolean {
	return value === null || value === undefined;
}

function relationConfidenceFromStrength(strength?: string): number {
	if (strength === 'strong') return 0.9;
	if (strength === 'weak') return 0.58;
	return 0.74;
}

function relationConfidenceFromTable(row: RelationRow, table: RelationTable): number {
	const strength = typeof row.strength === 'string' ? row.strength : undefined;
	if (table === 'supports' || table === 'contradicts') {
		return relationConfidenceFromStrength(strength);
	}
	if (table === 'depends_on') {
		const necessity = typeof row.necessity === 'string' ? row.necessity : '';
		if (necessity === 'essential') return 0.9;
		if (necessity === 'contextual') return 0.58;
		return 0.74;
	}
	if (table === 'responds_to') {
		const responseType = typeof row.response_type === 'string' ? row.response_type : '';
		if (responseType === 'direct_rebuttal') return 0.86;
		if (responseType === 'concession') return 0.6;
		return 0.72;
	}
	if (table === 'refines') {
		const refinementType = typeof row.refinement_type === 'string' ? row.refinement_type : '';
		if (refinementType === 'strengthens') return 0.84;
		if (refinementType === 'qualifies') return 0.68;
		return 0.74;
	}
	return 0.66;
}

function deriveEvidencePassages(row: RelationRow, claimPassageById: Map<string, string>): string[] {
	const inId = normalizeRecordId(row.in);
	const outId = normalizeRecordId(row.out);
	const values = new Set<string>();
	if (inId) {
		const inPassage = claimPassageById.get(inId);
		if (inPassage) values.add(inPassage);
	}
	if (outId) {
		const outPassage = claimPassageById.get(outId);
		if (outPassage) values.add(outPassage);
	}
	return Array.from(values);
}

async function connectDb(): Promise<Surreal> {
	const db = new Surreal();
	await db.connect(SURREAL_URL);
	try {
		await db.signin({
			namespace: SURREAL_NAMESPACE,
			database: SURREAL_DATABASE,
			username: SURREAL_USER,
			password: SURREAL_PASS
		} as any);
	} catch {
		await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
	}
	await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
	return db;
}

async function loadClaimPassages(db: Surreal): Promise<Map<string, string>> {
	const spinner = startSpinner('Loading claim passage map');
	const rows =
		(await db.query<ClaimPassageRow[][]>(`SELECT id, passage, passage_id FROM claim`))?.[0] ?? [];
	const map = new Map<string, string>();
	for (const row of rows) {
		const claimId = normalizeRecordId(row.id);
		if (!claimId) continue;
		const passage =
			normalizeRecordId(row.passage) ?? (typeof row.passage_id === 'string' ? row.passage_id : null);
		if (passage) {
			const passageIdPart = passage.includes(':') ? passage.split(':').slice(1).join(':') : passage;
			map.set(claimId, passageIdPart);
		}
	}
	spinner.stop(`✓ Claim passage map loaded (${map.size} linked claims)`);
	return map;
}

function buildPatch(row: RelationRow, table: RelationTable, claimPassageById: Map<string, string>) {
	const patch: Record<string, unknown> = {};

	if ((table === 'supports' || table === 'contradicts') && isMissing(row.strength)) {
		patch.strength = 'moderate';
	}
	if (table === 'depends_on' && isMissing(row.necessity)) {
		const strength = typeof row.strength === 'string' ? row.strength : '';
		patch.necessity =
			strength === 'strong' ? 'essential' : strength === 'weak' ? 'contextual' : 'supporting';
	}
	if (table === 'responds_to' && isMissing(row.response_type)) {
		const strength = typeof row.strength === 'string' ? row.strength : '';
		patch.response_type =
			strength === 'strong'
				? 'direct_rebuttal'
				: strength === 'weak'
					? 'concession'
					: 'undermining';
	}
	if (table === 'refines' && isMissing(row.refinement_type)) {
		const strength = typeof row.strength === 'string' ? row.strength : '';
		patch.refinement_type =
			strength === 'strong' ? 'strengthens' : strength === 'weak' ? 'qualifies' : 'clarifies';
	}

	const confidence =
		typeof row.relation_confidence === 'number'
			? row.relation_confidence
			: relationConfidenceFromTable(row, table);
	if (isMissing(row.relation_confidence)) {
		patch.relation_confidence = confidence;
	}
	if (isMissing(row.relation_inference_mode)) {
		patch.relation_inference_mode = 'inferred';
	}
	if (isMissing(row.verification_state)) {
		patch.verification_state = 'unverified';
	}
	if (isMissing(row.review_state)) {
		patch.review_state =
			confidence < LOW_CONFIDENCE_REVIEW_THRESHOLD ? 'needs_review' : 'candidate';
	}
	if (isMissing(row.extractor_version)) {
		patch.extractor_version = BACKFILL_EXTRACTOR_VERSION;
	}

	const existingEvidence = Array.isArray(row.evidence_passages) ? row.evidence_passages : [];
	if (existingEvidence.length === 0) {
		const inferredEvidence = deriveEvidencePassages(row, claimPassageById);
		if (inferredEvidence.length > 0) {
			patch.evidence_passages = inferredEvidence;
		}
	}

	return patch;
}

async function backfillTable(
	db: Surreal,
	table: RelationTable,
	claimPassageById: Map<string, string>,
	dryRun: boolean
): Promise<TableSummary> {
	const selectQueryByTable: Record<RelationTable, string> = {
		supports: `SELECT
				id, in, out, strength, necessity, response_type, refinement_type,
				relation_confidence, relation_inference_mode, verification_state, review_state,
				extractor_version, evidence_passages
			FROM supports`,
		contradicts: `SELECT
				id, in, out, strength, necessity, response_type, refinement_type,
				relation_confidence, relation_inference_mode, verification_state, review_state,
				extractor_version, evidence_passages
			FROM contradicts`,
		depends_on: `SELECT
				id, in, out, strength, necessity, response_type, refinement_type,
				relation_confidence, relation_inference_mode, verification_state, review_state,
				extractor_version, evidence_passages
			FROM depends_on`,
		responds_to: `SELECT
				id, in, out, strength, necessity, response_type, refinement_type,
				relation_confidence, relation_inference_mode, verification_state, review_state,
				extractor_version, evidence_passages
			FROM responds_to`,
		refines: `SELECT
				id, in, out, strength, necessity, response_type, refinement_type,
				relation_confidence, relation_inference_mode, verification_state, review_state,
				extractor_version, evidence_passages
			FROM refines`,
		exemplifies: `SELECT
				id, in, out, strength, necessity, response_type, refinement_type,
				relation_confidence, relation_inference_mode, verification_state, review_state,
				extractor_version, evidence_passages
			FROM exemplifies`
	};
	const timer = startStageTimer();
	const spinner = startSpinner(`Scanning ${table}`);
	const rows = (await db.query<RelationRow[][]>(selectQueryByTable[table]))?.[0] ?? [];
	let updatedRows = 0;
	let alreadyComplete = 0;

	for (const row of rows) {
		const rowId = normalizeRecordId(row.id);
		if (!rowId) continue;
		const patch = buildPatch(row, table, claimPassageById);
		const evidencePassageIds = Array.isArray(patch.evidence_passages)
			? (patch.evidence_passages as string[])
			: [];
		if (evidencePassageIds.length > 0) {
			delete patch.evidence_passages;
		}
		const patchKeys = Object.keys(patch);
		if (patchKeys.length === 0 && evidencePassageIds.length === 0) {
			alreadyComplete += 1;
			continue;
		}
		updatedRows += 1;
		if (!dryRun) {
			const relationIdPart = rowId.includes(':') ? rowId.split(':').slice(1).join(':') : rowId;
			if (patchKeys.length > 0) {
				await db.query(`UPDATE type::record($table, $rid) MERGE $patch`, {
					table,
					rid: relationIdPart,
					patch
				});
			}
			if (evidencePassageIds.length > 0) {
				await db.query(
					`UPDATE type::record($table, $rid) SET evidence_passages = array::map($passage_ids, |$pid| type::record('passage', $pid))`,
					{
						table,
						rid: relationIdPart,
						passage_ids: evidencePassageIds
					}
				);
			}
		}
	}

	spinner.stop(
		`✓ ${table}: ${rows.length} scanned, ${updatedRows} ${dryRun ? 'would update' : 'updated'} in ${timer.end()}`
	);
	return { totalRows: rows.length, updatedRows, alreadyComplete };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	console.log('[RELATION-BACKFILL] Starting relation metadata backfill');
	console.log(`[RELATION-BACKFILL] Mode: ${args.dryRun ? 'dry-run' : 'write'}`);
	const db = await connectDb();
	const overallTimer = startStageTimer();
	try {
		const claimPassageById = await loadClaimPassages(db);
		const results = new Map<RelationTable, TableSummary>();
		for (const table of RELATION_TABLES) {
			const summary = await backfillTable(db, table, claimPassageById, args.dryRun);
			results.set(table, summary);
		}

		let totalRows = 0;
		let totalUpdated = 0;
		let totalComplete = 0;
		console.log('\n[RELATION-BACKFILL] Summary');
		for (const table of RELATION_TABLES) {
			const summary = results.get(table)!;
			totalRows += summary.totalRows;
			totalUpdated += summary.updatedRows;
			totalComplete += summary.alreadyComplete;
			console.log(
				`  ${table}: total=${summary.totalRows} ${args.dryRun ? 'would_update' : 'updated'}=${summary.updatedRows} already_complete=${summary.alreadyComplete}`
			);
		}
		console.log(
			`  TOTAL: rows=${totalRows} ${args.dryRun ? 'would_update' : 'updated'}=${totalUpdated} already_complete=${totalComplete}`
		);
		console.log(`  Duration: ${overallTimer.end()}`);
	} finally {
		await db.close();
	}
}

main().catch((error) => {
	console.error('[RELATION-BACKFILL] Fatal:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});
