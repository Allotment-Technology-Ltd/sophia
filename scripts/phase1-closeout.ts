import { Buffer } from 'node:buffer';

type SixRelationTable = 'supports' | 'contradicts' | 'depends_on' | 'responds_to' | 'defines' | 'qualifies';
const SIX_RELATION_TABLES: SixRelationTable[] = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'defines',
	'qualifies'
];
const LEGACY_RELATION_TABLES = ['refines', 'exemplifies'] as const;

interface GateResult {
	name: string;
	pass: boolean;
	detail: string;
}

function parseArgs() {
	const args = process.argv.slice(2);
	const dryRun = args.includes('--dry-run');
	const minRelationConfidenceArgIndex = args.indexOf('--min-relation-confidence');
	const minRelationConfidence =
		minRelationConfidenceArgIndex >= 0 && args[minRelationConfidenceArgIndex + 1]
			? Number(args[minRelationConfidenceArgIndex + 1])
			: 0.78;
	if (!Number.isFinite(minRelationConfidence) || minRelationConfidence < 0 || minRelationConfidence > 1) {
		throw new Error('Invalid --min-relation-confidence; expected 0..1');
	}
	return { dryRun, minRelationConfidence };
}

function baseUrl(): string {
	const raw = process.env.SURREAL_URL || 'http://localhost:8800';
	const normalizedScheme = raw.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://');
	return normalizedScheme.replace(/\/rpc\/?$/, '').replace(/\/sql\/?$/, '').replace(/\/$/, '');
}

function authHeader(): string {
	const user = process.env.SURREAL_USER || 'root';
	const pass = process.env.SURREAL_PASS || 'root';
	return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function ns(): string {
	return process.env.SURREAL_NAMESPACE || 'sophia';
}

function dbName(): string {
	return process.env.SURREAL_DATABASE || 'sophia';
}

async function queryRows<T = Record<string, unknown>>(
	sql: string,
	vars: Record<string, unknown> = {}
): Promise<T[]> {
	const sets = Object.entries(vars)
		.map(([k, v]) => `LET $${k} = ${JSON.stringify(v)};`)
		.join(' ');
	const body = `${sets} ${sql}`;

	let res: Response | null = null;
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 120_000);
		try {
			res = await fetch(`${baseUrl()}/sql`, {
				method: 'POST',
				headers: {
					'Content-Type': 'text/plain',
					Accept: 'application/json',
					Authorization: authHeader(),
					'surreal-ns': ns(),
					'surreal-db': dbName()
				},
				body,
				signal: controller.signal
			});
			clearTimeout(timeout);
			lastError = null;
			break;
		} catch (error) {
			clearTimeout(timeout);
			lastError = error;
			if (attempt >= 3) break;
			await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
		}
	}

	if (!res) {
		throw new Error(
			`Failed to query Surreal after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`
		);
	}

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`HTTP ${res.status}: ${text}`);
	}

	const payload = (await res.json()) as Array<{ status: string; result?: unknown; detail?: string }>;
	const meaningful = payload.filter((row) => !(row.status === 'OK' && row.result === null));
	const last = meaningful[meaningful.length - 1] ?? payload[payload.length - 1];
	if (!last) return [];
	if (last.status !== 'OK') {
		throw new Error(last.detail || `Query failed: ${last.status}`);
	}
	if (!Array.isArray(last.result)) {
		return last.result ? [last.result as T] : [];
	}
	return last.result as T[];
}

async function execSql(sql: string, vars: Record<string, unknown> = {}): Promise<void> {
	await queryRows(sql, vars);
}

async function execSqlLabeled(
	label: string,
	sql: string,
	vars: Record<string, unknown> = {}
): Promise<void> {
	try {
		await execSql(sql, vars);
	} catch (error) {
		throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function scalarCount(sql: string, vars: Record<string, unknown> = {}): Promise<number> {
	const result = await queryRows<{ count?: number; c?: number }>(sql, vars);
	return Number(result[0]?.count ?? result[0]?.c ?? 0);
}

async function auditLog(entry: {
	entity_kind: 'claim' | 'relation' | 'claim_pair';
	entity_id: string;
	entity_table?: string;
	action: 'accept' | 'reject' | 'return_to_review' | 'merge' | 'classify_pair';
	notes: string;
	metadata?: Record<string, unknown>;
}): Promise<void> {
	await execSql(
		`CREATE review_audit_log CONTENT {
			entity_kind: $entity_kind,
			entity_id: $entity_id,
			entity_table: $entity_table,
			action: $action,
			previous_state: NONE,
			next_state: NONE,
			reviewer_uid: 'system:phase1-closeout',
			reviewer_email: 'system@sophia.local',
			source_id: NONE,
			source_title: 'Phase 1 Closeout',
			merge_target_id: NONE,
			merge_classification: NONE,
			notes: $notes,
			metadata: $metadata,
			created_at: time::now()
		}`,
		{
			entity_kind: entry.entity_kind,
			entity_id: entry.entity_id,
			entity_table: entry.entity_table ?? null,
			action: entry.action,
			notes: entry.notes,
			metadata: entry.metadata ?? null
		}
	);
}

async function normalizeStates(dryRun: boolean): Promise<Record<string, number>> {
	const stats: Record<string, number> = {};

	const claimMissingReview = await scalarCount(
		"SELECT count() AS count FROM claim WHERE review_state = NONE GROUP ALL"
	);
	const claimMissingVerification = await scalarCount(
		"SELECT count() AS count FROM claim WHERE verification_state = NONE GROUP ALL"
	);
	stats.claimMissingReview = claimMissingReview;
	stats.claimMissingVerification = claimMissingVerification;

	if (!dryRun) {
		if (claimMissingReview > 0) {
			await execSqlLabeled(
				'normalize.claim.review_state',
				"UPDATE claim SET review_state = 'candidate' WHERE review_state = NONE"
			);
		}
		if (claimMissingVerification > 0) {
			await execSqlLabeled(
				'normalize.claim.verification_state',
				"UPDATE claim SET verification_state = 'unverified' WHERE verification_state = NONE"
			);
		}
	}

	for (const table of SIX_RELATION_TABLES) {
		const missingReview = await scalarCount(
			`SELECT count() AS count FROM ${table} WHERE review_state = NONE GROUP ALL`
		);
		const missingVerification = await scalarCount(
			`SELECT count() AS count FROM ${table} WHERE verification_state = NONE GROUP ALL`
		);
		stats[`${table}MissingReview`] = missingReview;
		stats[`${table}MissingVerification`] = missingVerification;
		if (!dryRun) {
			if (missingReview > 0) {
				await execSqlLabeled(
					`normalize.${table}.review_state`,
					`UPDATE ${table} SET review_state = 'candidate' WHERE review_state = NONE`
				);
			}
			if (missingVerification > 0) {
				await execSqlLabeled(
					`normalize.${table}.verification_state`,
					`UPDATE ${table} SET verification_state = 'unverified' WHERE verification_state = NONE`
				);
			}
		}
	}

	for (const table of LEGACY_RELATION_TABLES) {
		const acceptedLegacy = await scalarCount(
			`SELECT count() AS count FROM ${table} WHERE review_state = 'accepted' GROUP ALL`
		);
		stats[`${table}AcceptedBefore`] = acceptedLegacy;
		if (!dryRun && acceptedLegacy > 0) {
			await execSqlLabeled(
				`normalize.${table}.accepted_to_needs_review`,
				`UPDATE ${table} SET review_state = 'needs_review' WHERE review_state = 'accepted'`
			);
		}
	}

	if (!dryRun) {
		await auditLog({
			entity_kind: 'claim',
			entity_id: `bulk:phase1-closeout:normalize:${Date.now()}`,
			entity_table: 'claim',
			action: 'classify_pair',
			notes: 'Phase 1 closeout: normalized null review/verification states.',
			metadata: stats
		});
	}

	return stats;
}

async function migratePromotionStates(
	dryRun: boolean,
	minRelationConfidence: number
): Promise<Record<string, number>> {
	const stats: Record<string, number> = {};

	const promotableClaims = await scalarCount(
		`SELECT count() AS count
		 FROM claim
		 WHERE review_state IN ['candidate', 'needs_review']
		   AND verification_state != 'flagged'
		   AND source_span_start != NONE
		   AND source_span_end != NONE
		   AND source_span_end >= source_span_start
		 GROUP ALL`
	);
	stats.claimsToAccept = promotableClaims;

	if (!dryRun && promotableClaims > 0) {
		await execSqlLabeled(
			'promotion.claim.accept',
			`UPDATE claim
			 SET review_state = 'accepted'
			 WHERE review_state IN ['candidate', 'needs_review']
			   AND verification_state != 'flagged'
			   AND source_span_start != NONE
			   AND source_span_end != NONE
			   AND source_span_end >= source_span_start`
		);
	}

	for (const table of SIX_RELATION_TABLES) {
		const lowConfidenceCount = await scalarCount(
			`SELECT count() AS count
			 FROM ${table}
			 WHERE relation_confidence = NONE OR relation_confidence < $threshold
			 GROUP ALL`,
			{ threshold: minRelationConfidence }
		);
		stats[`${table}LowConfidence`] = lowConfidenceCount;

		if (!dryRun && lowConfidenceCount > 0) {
			await execSqlLabeled(
				`promotion.${table}.route_low_confidence`,
				`UPDATE ${table}
				 SET review_state = 'needs_review'
				 WHERE (relation_confidence = NONE OR relation_confidence < $threshold)
				   AND review_state != 'accepted'`,
				{ threshold: minRelationConfidence }
			);
		}

		const promotableRelations = await scalarCount(
			`SELECT count() AS count
			 FROM ${table}
			 WHERE review_state IN ['candidate', 'needs_review']
			   AND verification_state != 'flagged'
			   AND relation_confidence != NONE
			   AND relation_confidence >= $threshold
			   AND evidence_passages != NONE
			   AND array::len(evidence_passages) > 0
			   AND in.review_state = 'accepted'
			   AND out.review_state = 'accepted'
			 GROUP ALL`,
			{ threshold: minRelationConfidence }
		);
		stats[`${table}ToAccept`] = promotableRelations;

		if (!dryRun && promotableRelations > 0) {
			await execSqlLabeled(
				`promotion.${table}.accept`,
				`UPDATE ${table}
				 SET review_state = 'accepted'
				 WHERE review_state IN ['candidate', 'needs_review']
				   AND verification_state != 'flagged'
				   AND relation_confidence != NONE
				   AND relation_confidence >= $threshold
				   AND evidence_passages != NONE
				   AND array::len(evidence_passages) > 0
				   AND in.review_state = 'accepted'
				   AND out.review_state = 'accepted'`,
				{ threshold: minRelationConfidence }
			);
		}
	}

	if (!dryRun) {
		await auditLog({
			entity_kind: 'relation',
			entity_id: `bulk:phase1-closeout:promotion:${Date.now()}`,
			entity_table: 'claim+relations',
			action: 'classify_pair',
			notes:
				'Phase 1 closeout: migrated promotable claims/relations to accepted and routed low-confidence relations to needs_review.',
			metadata: {
				minRelationConfidence,
				...stats
			}
		});
	}

	return stats;
}

async function computeAuditGates(minRelationConfidence: number): Promise<GateResult[]> {
	const totalSources = await scalarCount(`SELECT count() AS count FROM source GROUP ALL`);
	const claimsWithoutPassage = await scalarCount(
		`SELECT count() AS count FROM claim WHERE passage = NONE GROUP ALL`
	);

	const promotedClaims = await scalarCount(
		`SELECT count() AS count FROM claim WHERE review_state = 'accepted' GROUP ALL`
	);
	const promotedClaimsWithSpan = await scalarCount(
		`SELECT count() AS count
		 FROM claim
		 WHERE review_state = 'accepted'
		   AND source_span_start != NONE
		   AND source_span_end != NONE
		   AND source_span_end >= source_span_start
		 GROUP ALL`
	);
	const promotedClaimsUnverifiable = await scalarCount(
		`SELECT count() AS count
		 FROM claim
		 WHERE review_state = 'accepted'
		   AND (verification_state = NONE OR verification_state IN ['unverified', 'flagged'])
		 GROUP ALL`
	);

	const promotedSpanPct = promotedClaims > 0 ? (promotedClaimsWithSpan / promotedClaims) * 100 : 0;
	const promotedUnverifiablePct = promotedClaims > 0 ? (promotedClaimsUnverifiable / promotedClaims) * 100 : 100;

	const acceptedLegacyRefines = await scalarCount(
		`SELECT count() AS count FROM refines WHERE review_state = 'accepted' GROUP ALL`
	);
	const acceptedLegacyExemplifies = await scalarCount(
		`SELECT count() AS count FROM exemplifies WHERE review_state = 'accepted' GROUP ALL`
	);

	const acceptedClaimViolations = await scalarCount(
		`SELECT count() AS count
		 FROM claim
		 WHERE review_state = 'accepted'
		   AND (
			 source_span_start = NONE
			 OR source_span_end = NONE
			 OR source_span_end < source_span_start
		   )
		 GROUP ALL`
	);

	let lowConfidenceAcceptedTotal = 0;
	for (const table of SIX_RELATION_TABLES) {
		lowConfidenceAcceptedTotal += await scalarCount(
			`SELECT count() AS count
			 FROM ${table}
			 WHERE review_state = 'accepted'
			   AND (relation_confidence = NONE OR relation_confidence < $threshold)
			 GROUP ALL`,
			{ threshold: minRelationConfidence }
		);
	}

	let acceptedRelationBlockerTotal = 0;
	for (const table of SIX_RELATION_TABLES) {
		acceptedRelationBlockerTotal += await scalarCount(
			`SELECT count() AS count
			 FROM ${table}
			 WHERE review_state = 'accepted'
			   AND (
				 evidence_passages = NONE
				 OR array::len(evidence_passages) = 0
			   )
			 GROUP ALL`
		);
	}

	const reviewAuditCount = await scalarCount(`SELECT count() AS count FROM review_audit_log GROUP ALL`);

	const gates: GateResult[] = [
		{
			name: 'source_integrity_no_claim_without_passage',
			pass: claimsWithoutPassage === 0,
			detail: `claims_without_passage=${claimsWithoutPassage}, total_sources=${totalSources}`
		},
		{
			name: 'claim_span_attachment_on_promoted',
			pass: promotedClaims > 0 && promotedSpanPct >= 90,
			detail: `promoted_with_span=${promotedClaimsWithSpan}/${promotedClaims} (${promotedSpanPct.toFixed(2)}%)`
		},
		{
			name: 'promoted_claim_unverifiable_rate',
			pass: promotedClaims > 0 && promotedUnverifiablePct < 5,
			detail: `unverifiable_promoted=${promotedClaimsUnverifiable}/${promotedClaims} (${promotedUnverifiablePct.toFixed(2)}%)`
		},
		{
			name: 'trusted_relation_partition_no_legacy_edges',
			pass: acceptedLegacyRefines + acceptedLegacyExemplifies === 0,
			detail: `accepted_refines=${acceptedLegacyRefines}, accepted_exemplifies=${acceptedLegacyExemplifies}`
		},
		{
			name: 'promotion_rules_claims',
			pass: acceptedClaimViolations === 0,
			detail: `accepted_claim_violations=${acceptedClaimViolations}`
		},
		{
			name: 'promotion_rules_relations',
			pass: acceptedRelationBlockerTotal === 0,
			detail: `accepted_relation_blockers=${acceptedRelationBlockerTotal}`
		},
		{
			name: 'low_confidence_relations_not_accepted',
			pass: lowConfidenceAcceptedTotal === 0,
			detail: `low_confidence_accepted_relations=${lowConfidenceAcceptedTotal} (threshold=${minRelationConfidence})`
		},
		{
			name: 'audit_trail_present',
			pass: reviewAuditCount > 0,
			detail: `review_audit_log_rows=${reviewAuditCount}`
		}
	];

	return gates;
}

async function authSmokeTest(): Promise<void> {
	await scalarCount('SELECT count() AS count FROM source GROUP ALL');
}

async function main() {
	const { dryRun, minRelationConfidence } = parseArgs();
	console.log(`[PHASE1-CLOSEOUT] baseUrl=${baseUrl()} ns=${ns()} db=${dbName()} dryRun=${dryRun}`);
	await authSmokeTest();
	console.log('[PHASE1-CLOSEOUT] Auth/query smoke test passed.');

	const normalization = await normalizeStates(dryRun);
	console.log('[NORMALIZE]', JSON.stringify(normalization));

	const promotion = await migratePromotionStates(dryRun, minRelationConfidence);
	console.log('[PROMOTION]', JSON.stringify(promotion));

	const gates = await computeAuditGates(minRelationConfidence);
	console.log('\n[PHASE1 GATES]');
	for (const gate of gates) {
		console.log(`  - ${gate.pass ? 'PASS' : 'FAIL'} ${gate.name}: ${gate.detail}`);
	}

	const failed = gates.filter((gate) => !gate.pass);
	if (failed.length > 0) {
		process.exitCode = 2;
	}
}

main().catch((error) => {
	console.error('[PHASE1-CLOSEOUT] Fatal:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});
