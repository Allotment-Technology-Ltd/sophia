import { create, query, update } from '$lib/server/db';
import type { ReviewState, VerificationState } from '@restormel/contracts/ingestion';

export const REVIEWABLE_RELATION_TABLES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'defines',
	'qualifies'
] as const;

export const DUPLICATE_CLASSIFICATIONS = [
	'exact_duplicate',
	'paraphrase_duplicate',
	'broader_narrower',
	'related_not_duplicate'
] as const;

export type ReviewableRelationTable = (typeof REVIEWABLE_RELATION_TABLES)[number];
export type DuplicateClassification = (typeof DUPLICATE_CLASSIFICATIONS)[number];
export type ReviewEntityKind = 'claim' | 'relation' | 'claim_pair';
export type ReviewAction =
	| 'accept'
	| 'reject'
	| 'return_to_review'
	| 'merge'
	| 'classify_pair';

export interface ReviewActor {
	uid: string;
	email?: string | null;
}

export interface ReviewStateCounts {
	candidate: number;
	accepted: number;
	rejected: number;
	merged: number;
	needs_review: number;
}

export interface ReviewSourceRef {
	id: string;
	title: string;
}

export interface ClaimReviewItem {
	id: string;
	text: string;
	claim_type: string;
	domain: string;
	confidence: number;
	position_in_source: number | null;
	passage_role?: string | null;
	review_state: ReviewState;
	verification_state?: VerificationState | null;
	source_span_start?: number | null;
	source_span_end?: number | null;
	source: ReviewSourceRef;
	promotable: boolean;
	blockers: string[];
	merge_target?: string | null;
	merge_classification?: DuplicateClassification | null;
	review_notes?: string | null;
	reviewed_at?: string | null;
	reviewed_by?: string | null;
}

export interface RelationReviewItem {
	id: string;
	table: ReviewableRelationTable;
	strength?: string | null;
	note?: string | null;
	relation_confidence?: number | null;
	relation_inference_mode?: string | null;
	review_state: ReviewState;
	verification_state?: VerificationState | null;
	evidence_passages: string[];
	from_claim: Pick<
		ClaimReviewItem,
		'id' | 'text' | 'position_in_source' | 'review_state' | 'verification_state' | 'source'
	>;
	to_claim: Pick<
		ClaimReviewItem,
		'id' | 'text' | 'position_in_source' | 'review_state' | 'verification_state' | 'source'
	>;
	promotable: boolean;
	blockers: string[];
	review_notes?: string | null;
	reviewed_at?: string | null;
	reviewed_by?: string | null;
}

export interface DuplicateSuggestion {
	pair_key: string;
	left: ClaimReviewItem;
	right: ClaimReviewItem;
	suggested_classification: DuplicateClassification;
	recommended_canonical_claim_id: string;
	score: number;
	reason: string;
}

export interface ReviewAuditEntry {
	id: string;
	entity_kind: ReviewEntityKind;
	entity_id: string;
	entity_table?: string | null;
	action: ReviewAction;
	previous_state?: ReviewState | null;
	next_state?: ReviewState | null;
	reviewer_uid: string;
	reviewer_email?: string | null;
	source_id?: string | null;
	source_title?: string | null;
	merge_target_id?: string | null;
	merge_classification?: DuplicateClassification | null;
	notes?: string | null;
	metadata?: Record<string, unknown> | null;
	created_at: string;
}

export interface ReviewDashboardData {
	trustedGraphActive: boolean;
	claimCounts: ReviewStateCounts;
	relationCounts: ReviewStateCounts;
	claimQueue: ClaimReviewItem[];
	relationQueue: RelationReviewItem[];
	duplicateSuggestions: DuplicateSuggestion[];
	recentAudit: ReviewAuditEntry[];
}

interface ClaimRow {
	id: string;
	text: string;
	claim_type: string;
	domain: string;
	confidence: number;
	position_in_source?: number | null;
	passage_role?: string | null;
	review_state?: ReviewState | null;
	verification_state?: VerificationState | null;
	source_span_start?: number | null;
	source_span_end?: number | null;
	review_notes?: string | null;
	reviewed_at?: string | null;
	reviewed_by?: string | null;
	merge_target?: string | null;
	merge_classification?: DuplicateClassification | null;
	source?: { id?: string; title?: string } | string | null;
}

interface RelationRow {
	id: string;
	strength?: string | null;
	note?: string | null;
	relation_confidence?: number | null;
	relation_inference_mode?: string | null;
	review_state?: ReviewState | null;
	verification_state?: VerificationState | null;
	evidence_passages?: Array<string | { id?: string }> | null;
	review_notes?: string | null;
	reviewed_at?: string | null;
	reviewed_by?: string | null;
	from_claim?: ClaimRow | null;
	to_claim?: ClaimRow | null;
}

interface CountRow {
	review_state?: ReviewState | null;
	count?: number | null;
}

function emptyCounts(): ReviewStateCounts {
	return {
		candidate: 0,
		accepted: 0,
		rejected: 0,
		merged: 0,
		needs_review: 0
	};
}

function sourceRef(source: ClaimRow['source']): ReviewSourceRef {
	if (source && typeof source === 'object') {
		return {
			id: String(source.id ?? 'unknown'),
			title: source.title ?? 'Unknown source'
		};
	}

	return {
		id: String(source ?? 'unknown'),
		title: String(source ?? 'Unknown source')
	};
}

function normalizeClaimRow(row: ClaimRow): ClaimReviewItem {
	const item: ClaimReviewItem = {
		id: row.id,
		text: row.text,
		claim_type: row.claim_type,
		domain: row.domain,
		confidence: row.confidence ?? 0,
		position_in_source: row.position_in_source ?? null,
		passage_role: row.passage_role ?? null,
		review_state: row.review_state ?? 'candidate',
		verification_state: row.verification_state ?? null,
		source_span_start: row.source_span_start ?? null,
		source_span_end: row.source_span_end ?? null,
		source: sourceRef(row.source),
		merge_target: row.merge_target ?? null,
		merge_classification: row.merge_classification ?? null,
		review_notes: row.review_notes ?? null,
		reviewed_at: row.reviewed_at ?? null,
		reviewed_by: row.reviewed_by ?? null,
		promotable: false,
		blockers: []
	};

	item.blockers = claimPromotionBlockers(item);
	item.promotable = item.blockers.length === 0;
	return item;
}

function normalizeRelationRow(table: ReviewableRelationTable, row: RelationRow): RelationReviewItem {
	const evidencePassages = (row.evidence_passages ?? [])
		.map((entry) => {
			if (typeof entry === 'string') return entry;
			if (entry && typeof entry === 'object' && entry.id) return String(entry.id);
			return null;
		})
		.filter((entry): entry is string => Boolean(entry));

	const fromClaim = normalizeClaimRow(row.from_claim ?? fallbackClaimRow('Unknown from-claim'));
	const toClaim = normalizeClaimRow(row.to_claim ?? fallbackClaimRow('Unknown to-claim'));
	const item: RelationReviewItem = {
		id: row.id,
		table,
		strength: row.strength ?? null,
		note: row.note ?? null,
		relation_confidence: row.relation_confidence ?? null,
		relation_inference_mode: row.relation_inference_mode ?? null,
		review_state: row.review_state ?? 'candidate',
		verification_state: row.verification_state ?? null,
		evidence_passages: evidencePassages,
		from_claim: {
			id: fromClaim.id,
			text: fromClaim.text,
			position_in_source: fromClaim.position_in_source,
			review_state: fromClaim.review_state,
			verification_state: fromClaim.verification_state,
			source: fromClaim.source
		},
		to_claim: {
			id: toClaim.id,
			text: toClaim.text,
			position_in_source: toClaim.position_in_source,
			review_state: toClaim.review_state,
			verification_state: toClaim.verification_state,
			source: toClaim.source
		},
		review_notes: row.review_notes ?? null,
		reviewed_at: row.reviewed_at ?? null,
		reviewed_by: row.reviewed_by ?? null,
		promotable: false,
		blockers: []
	};

	item.blockers = relationPromotionBlockers(item);
	item.promotable = item.blockers.length === 0;
	return item;
}

function fallbackClaimRow(label: string): ClaimRow {
	return {
		id: `claim:unknown:${label}`,
		text: label,
		claim_type: 'premise',
		domain: 'ethics',
		confidence: 0,
		position_in_source: null,
		review_state: 'needs_review',
		verification_state: 'unverified',
		source: { id: 'source:unknown', title: 'Unknown source' }
	};
}

export function claimPromotionBlockers(
	claim: Pick<
		ClaimReviewItem,
		| 'review_state'
		| 'verification_state'
		| 'source_span_start'
		| 'source_span_end'
		| 'merge_target'
	>
): string[] {
	const blockers: string[] = [];
	if (claim.review_state === 'rejected') blockers.push('rejected');
	if (claim.review_state === 'merged') blockers.push('merged');
	if (claim.verification_state === 'flagged') blockers.push('flagged');
	if (typeof claim.source_span_start !== 'number' || typeof claim.source_span_end !== 'number') {
		blockers.push('missing_source_span');
	} else if (claim.source_span_end < claim.source_span_start) {
		blockers.push('invalid_source_span');
	}
	if (claim.merge_target) blockers.push('merged_into_other_claim');
	return blockers;
}

export function relationPromotionBlockers(
	relation: Pick<
		RelationReviewItem,
		| 'verification_state'
		| 'relation_confidence'
		| 'evidence_passages'
		| 'from_claim'
		| 'to_claim'
	>
): string[] {
	const blockers: string[] = [];
	if (relation.verification_state === 'flagged') blockers.push('flagged');
	if (
		typeof relation.relation_confidence !== 'number' ||
		!Number.isFinite(relation.relation_confidence)
	) {
		blockers.push('missing_relation_confidence');
	}
	if (!Array.isArray(relation.evidence_passages) || relation.evidence_passages.length === 0) {
		blockers.push('missing_evidence_passages');
	}
	if (relation.from_claim.review_state === 'rejected' || relation.to_claim.review_state === 'rejected') {
		blockers.push('rejected_endpoint');
	}
	if (relation.from_claim.review_state === 'merged' || relation.to_claim.review_state === 'merged') {
		blockers.push('merged_endpoint');
	}
	return blockers;
}

function mergeCounts(into: ReviewStateCounts, rows: CountRow[]): ReviewStateCounts {
	const next = { ...into };
	for (const row of rows) {
		const key = row.review_state ?? 'candidate';
		if (!(key in next)) continue;
		next[key as keyof ReviewStateCounts] += row.count ?? 0;
	}
	return next;
}

function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizedTokens(text: string): string[] {
	const STOPWORDS = new Set([
		'the',
		'a',
		'an',
		'and',
		'or',
		'but',
		'that',
		'this',
		'these',
		'those',
		'for',
		'with',
		'from',
		'into',
		'than',
		'then',
		'therefore',
		'because',
		'is',
		'are',
		'was',
		'were',
		'be',
		'being',
		'been',
		'of',
		'on',
		'in',
		'to',
		'by'
	]);

	return normalizeText(text)
		.split(' ')
		.filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function jaccard(left: string[], right: string[]): number {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	let intersection = 0;
	for (const token of leftSet) {
		if (rightSet.has(token)) intersection += 1;
	}
	const union = new Set([...leftSet, ...rightSet]).size;
	return union === 0 ? 0 : intersection / union;
}

function tokenCoverage(smaller: string[], larger: string[]): number {
	if (smaller.length === 0) return 0;
	const largerSet = new Set(larger);
	let matches = 0;
	for (const token of smaller) {
		if (largerSet.has(token)) matches += 1;
	}
	return matches / smaller.length;
}

function pairKey(leftClaimId: string, rightClaimId: string): string {
	return [leftClaimId, rightClaimId].sort().join('::');
}

function selectCanonicalClaim(left: ClaimReviewItem, right: ClaimReviewItem): ClaimReviewItem {
	if (left.promotable !== right.promotable) return left.promotable ? left : right;
	if (left.confidence !== right.confidence) return left.confidence >= right.confidence ? left : right;
	if ((left.position_in_source ?? Infinity) !== (right.position_in_source ?? Infinity)) {
		return (left.position_in_source ?? Infinity) <= (right.position_in_source ?? Infinity) ? left : right;
	}
	return left.id <= right.id ? left : right;
}

export function suggestDuplicateClassification(
	left: ClaimReviewItem,
	right: ClaimReviewItem
): { classification: DuplicateClassification; score: number; reason: string } | null {
	if (left.id === right.id) return null;
	if (left.source.id !== right.source.id) return null;

	const leftNormalized = normalizeText(left.text);
	const rightNormalized = normalizeText(right.text);
	if (!leftNormalized || !rightNormalized) return null;

	if (leftNormalized === rightNormalized) {
		return {
			classification: 'exact_duplicate',
			score: 1,
			reason: 'Normalized claim text is identical.'
		};
	}

	const leftTokens = normalizedTokens(left.text);
	const rightTokens = normalizedTokens(right.text);
	const similarity = jaccard(leftTokens, rightTokens);
	const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
	const longer = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
	const coverage = tokenCoverage(shorter, longer);

	if (similarity >= 0.84) {
		return {
			classification: 'paraphrase_duplicate',
			score: similarity,
			reason: 'Token overlap is high enough to indicate a near-paraphrase duplicate.'
		};
	}

	if (coverage >= 0.9 && Math.abs(leftTokens.length - rightTokens.length) >= 2) {
		return {
			classification: 'broader_narrower',
			score: coverage,
			reason: 'One claim substantially contains the vocabulary of the other while adding or dropping scope.'
		};
	}

	if (similarity >= 0.58) {
		return {
			classification: 'related_not_duplicate',
			score: similarity,
			reason: 'Claims share substantial vocabulary but do not clear duplicate thresholds.'
		};
	}

	return null;
}

async function recordAudit(entry: Omit<ReviewAuditEntry, 'id' | 'created_at'>): Promise<void> {
	await create('review_audit_log', {
		...entry,
		created_at: new Date().toISOString()
	} as Record<string, unknown>);
}

async function loadClaimById(claimId: string): Promise<ClaimReviewItem> {
	const rows = await query<ClaimRow[]>(
		`SELECT
			id,
			text,
			claim_type,
			domain,
			confidence,
			position_in_source,
			passage_role,
			review_state,
			verification_state,
			source_span_start,
			source_span_end,
			review_notes,
			reviewed_at,
			reviewed_by,
			merge_target,
			merge_classification,
			source.{id, title} AS source
		FROM type::thing($claim_id)`,
		{ claim_id: claimId }
	);
	const row = rows[0];
	if (!row) throw new Error(`Claim not found: ${claimId}`);
	return normalizeClaimRow(row);
}

async function loadRelationById(
	table: ReviewableRelationTable,
	relationId: string
): Promise<RelationReviewItem> {
	const rows = await query<RelationRow[]>(
		`SELECT
			id,
			strength,
			note,
			relation_confidence,
			relation_inference_mode,
			review_state,
			verification_state,
			evidence_passages,
			review_notes,
			reviewed_at,
			reviewed_by,
			in.{id, text, position_in_source, review_state, verification_state, source.{id, title}} AS from_claim,
			out.{id, text, position_in_source, review_state, verification_state, source.{id, title}} AS to_claim
		FROM ${table}
		WHERE id = type::thing($relation_id)
		LIMIT 1`,
		{ relation_id: relationId }
	);
	const row = rows[0];
	if (!row) throw new Error(`Relation not found: ${relationId}`);
	return normalizeRelationRow(table, row);
}

function reviewActionForState(nextState: ReviewState): ReviewAction {
	if (nextState === 'accepted') return 'accept';
	if (nextState === 'rejected') return 'reject';
	return 'return_to_review';
}

function assertClaimTransition(nextState: ReviewState): void {
	if (nextState === 'merged') {
		throw new Error('Use duplicate resolution to merge claims.');
	}
}

function sourceIdPart(sourceId: string): string {
	return sourceId.includes(':') ? sourceId.split(':').slice(1).join(':') : sourceId;
}

async function sourcePassageIntegrityOk(sourceId: string): Promise<boolean> {
	if (!sourceId || sourceId === 'unknown' || sourceId === 'source:unknown') return false;
	const sid = sourceIdPart(sourceId);
	const claimRows = await query<Array<{ id: string }>>(
		`SELECT id FROM claim WHERE source = type::thing('source', $sid) LIMIT 1`,
		{ sid }
	);
	if (!claimRows || claimRows.length === 0) return true;
	const passageRows = await query<Array<{ id: string }>>(
		`SELECT id FROM passage WHERE source = type::thing('source', $sid) LIMIT 1`,
		{ sid }
	);
	return Array.isArray(passageRows) && passageRows.length > 0;
}

export async function applyClaimReviewDecision(params: {
	claimId: string;
	nextState: Exclude<ReviewState, 'merged'>;
	actor: ReviewActor;
	notes?: string;
}): Promise<ClaimReviewItem> {
	const current = await loadClaimById(params.claimId);
	assertClaimTransition(params.nextState);

	if (params.nextState === 'accepted' && !current.promotable) {
		throw new Error(`Claim cannot be accepted: ${current.blockers.join(', ')}`);
	}
	if (params.nextState === 'accepted') {
		const sourceOk = await sourcePassageIntegrityOk(current.source.id);
		if (!sourceOk) {
			throw new Error(
				'Claim cannot be accepted: source integrity gate failed (claims exist but passages are missing).'
			);
		}
	}

	const updated = await update<ClaimRow>(current.id, {
		review_state: params.nextState,
		review_notes: params.notes?.trim() || undefined,
		reviewed_by: params.actor.uid,
		reviewed_at: new Date().toISOString()
	});

	await recordAudit({
		entity_kind: 'claim',
		entity_id: current.id,
		entity_table: 'claim',
		action: reviewActionForState(params.nextState),
		previous_state: current.review_state,
		next_state: params.nextState,
		reviewer_uid: params.actor.uid,
		reviewer_email: params.actor.email ?? null,
		source_id: current.source.id,
		source_title: current.source.title,
		notes: params.notes?.trim() || null
	});

	return normalizeClaimRow(updated);
}

export async function applyRelationReviewDecision(params: {
	table: ReviewableRelationTable;
	relationId: string;
	nextState: Exclude<ReviewState, 'merged'>;
	actor: ReviewActor;
	notes?: string;
}): Promise<RelationReviewItem> {
	const current = await loadRelationById(params.table, params.relationId);
	assertClaimTransition(params.nextState);

	if (params.nextState === 'accepted' && !current.promotable) {
		throw new Error(`Relation cannot be accepted: ${current.blockers.join(', ')}`);
	}
	if (params.nextState === 'accepted') {
		const [fromOk, toOk] = await Promise.all([
			sourcePassageIntegrityOk(current.from_claim.source.id),
			sourcePassageIntegrityOk(current.to_claim.source.id)
		]);
		if (!fromOk || !toOk) {
			throw new Error(
				'Relation cannot be accepted: source integrity gate failed (claims exist but passages are missing).'
			);
		}
	}

	const updated = await update<RelationRow>(current.id, {
		review_state: params.nextState,
		review_notes: params.notes?.trim() || undefined,
		reviewed_by: params.actor.uid,
		reviewed_at: new Date().toISOString()
	});

	await recordAudit({
		entity_kind: 'relation',
		entity_id: current.id,
		entity_table: params.table,
		action: reviewActionForState(params.nextState),
		previous_state: current.review_state,
		next_state: params.nextState,
		reviewer_uid: params.actor.uid,
		reviewer_email: params.actor.email ?? null,
		source_id: current.from_claim.source.id,
		source_title: current.from_claim.source.title,
		notes: params.notes?.trim() || null
	});

	return normalizeRelationRow(params.table, updated);
}

export async function resolveClaimPairReview(params: {
	leftClaimId: string;
	rightClaimId: string;
	classification: DuplicateClassification;
	actor: ReviewActor;
	notes?: string;
	canonicalClaimId?: string;
}): Promise<{
	classification: DuplicateClassification;
	canonicalClaimId: string;
	pairKey: string;
}> {
	const left = await loadClaimById(params.leftClaimId);
	const right = await loadClaimById(params.rightClaimId);
	const key = pairKey(left.id, right.id);
	const canonical = params.canonicalClaimId
		? [left, right].find((claim) => claim.id === params.canonicalClaimId)
		: selectCanonicalClaim(left, right);

	if (!canonical) {
		throw new Error('Canonical claim must be one of the reviewed pair.');
	}

	if (
		(params.classification === 'exact_duplicate' ||
			params.classification === 'paraphrase_duplicate') &&
		!canonical.promotable &&
		canonical.review_state !== 'accepted'
	) {
		throw new Error(`Canonical claim cannot be promoted: ${canonical.blockers.join(', ')}`);
	}

	const secondary = canonical.id === left.id ? right : left;
	const notes = params.notes?.trim() || null;
	const reviewedAt = new Date().toISOString();

	if (
		params.classification === 'exact_duplicate' ||
		params.classification === 'paraphrase_duplicate'
	) {
		const canonicalNextState: ReviewState =
			canonical.review_state === 'accepted' ? 'accepted' : 'accepted';
		await update(canonical.id, {
			review_state: canonicalNextState,
			review_notes: notes ?? undefined,
			reviewed_by: params.actor.uid,
			reviewed_at: reviewedAt
		});

		await update(secondary.id, {
			review_state: 'merged',
			merge_target: canonical.id,
			merge_classification: params.classification,
			review_notes: notes ?? undefined,
			reviewed_by: params.actor.uid,
			reviewed_at: reviewedAt
		});

		if (canonical.review_state !== canonicalNextState) {
			await recordAudit({
				entity_kind: 'claim',
				entity_id: canonical.id,
				entity_table: 'claim',
				action: 'accept',
				previous_state: canonical.review_state,
				next_state: canonicalNextState,
				reviewer_uid: params.actor.uid,
				reviewer_email: params.actor.email ?? null,
				source_id: canonical.source.id,
				source_title: canonical.source.title,
				merge_classification: params.classification,
				notes
			});
		}

		await recordAudit({
			entity_kind: 'claim',
			entity_id: secondary.id,
			entity_table: 'claim',
			action: 'merge',
			previous_state: secondary.review_state,
			next_state: 'merged',
			reviewer_uid: params.actor.uid,
			reviewer_email: params.actor.email ?? null,
			source_id: secondary.source.id,
			source_title: secondary.source.title,
			merge_target_id: canonical.id,
			merge_classification: params.classification,
			notes
		});
	} else {
		const leftNext: ReviewState =
			left.promotable && left.review_state !== 'accepted' ? 'accepted' : left.review_state;
		const rightNext: ReviewState =
			right.promotable && right.review_state !== 'accepted' ? 'accepted' : right.review_state;

		await update(left.id, {
			review_state: leftNext,
			review_notes: notes ?? undefined,
			reviewed_by: params.actor.uid,
			reviewed_at: reviewedAt
		});
		await update(right.id, {
			review_state: rightNext,
			review_notes: notes ?? undefined,
			reviewed_by: params.actor.uid,
			reviewed_at: reviewedAt
		});

		if (left.review_state !== leftNext) {
			await recordAudit({
				entity_kind: 'claim',
				entity_id: left.id,
				entity_table: 'claim',
				action: 'accept',
				previous_state: left.review_state,
				next_state: leftNext,
				reviewer_uid: params.actor.uid,
				reviewer_email: params.actor.email ?? null,
				source_id: left.source.id,
				source_title: left.source.title,
				merge_classification: params.classification,
				notes
			});
		}
		if (right.review_state !== rightNext) {
			await recordAudit({
				entity_kind: 'claim',
				entity_id: right.id,
				entity_table: 'claim',
				action: 'accept',
				previous_state: right.review_state,
				next_state: rightNext,
				reviewer_uid: params.actor.uid,
				reviewer_email: params.actor.email ?? null,
				source_id: right.source.id,
				source_title: right.source.title,
				merge_classification: params.classification,
				notes
			});
		}
	}

	await recordAudit({
		entity_kind: 'claim_pair',
		entity_id: key,
		entity_table: 'claim_pair',
		action: 'classify_pair',
		previous_state: null,
		next_state: null,
		reviewer_uid: params.actor.uid,
		reviewer_email: params.actor.email ?? null,
		source_id: canonical.source.id,
		source_title: canonical.source.title,
		merge_target_id:
			params.classification === 'exact_duplicate' ||
			params.classification === 'paraphrase_duplicate'
				? canonical.id
				: null,
		merge_classification: params.classification,
		notes,
		metadata: {
			left_claim_id: left.id,
			right_claim_id: right.id,
			canonical_claim_id: canonical.id
		}
	});

	return {
		classification: params.classification,
		canonicalClaimId: canonical.id,
		pairKey: key
	};
}

export async function loadReviewDashboard(limit = 24): Promise<ReviewDashboardData> {
	const claimQueueFetchLimit = Math.max(limit * 3, limit);
	const duplicateCandidateLimit = Math.max(limit * 10, 240);

	const [
		claimCountRows,
		claimQueueRows,
		recentAudit,
		pairAuditRows,
		duplicateClaimRows,
		...relationResults
	] = await Promise.all([
		query<CountRow[]>(
			'SELECT review_state, count() AS count FROM claim GROUP BY review_state'
		),
		query<ClaimRow[]>(
			`SELECT
				id,
				text,
				claim_type,
				domain,
				confidence,
				position_in_source,
				passage_role,
				review_state,
				verification_state,
				source_span_start,
				source_span_end,
				review_notes,
				reviewed_at,
				reviewed_by,
				merge_target,
				merge_classification,
				source.{id, title} AS source
			FROM claim
			WHERE review_state IN ['candidate', 'needs_review']
			ORDER BY review_state DESC, confidence ASC, position_in_source ASC, id ASC
			LIMIT $limit`,
			{ limit: claimQueueFetchLimit }
		),
		query<ReviewAuditEntry[]>(
			`SELECT
				id,
				entity_kind,
				entity_id,
				entity_table,
				action,
				previous_state,
				next_state,
				reviewer_uid,
				reviewer_email,
				source_id,
				source_title,
				merge_target_id,
				merge_classification,
				notes,
				metadata,
				created_at
			FROM review_audit_log
			ORDER BY created_at DESC
			LIMIT 20`
		).catch(() => []),
		query<Array<{ entity_id: string }>>(
			`SELECT entity_id
			FROM review_audit_log
			WHERE entity_kind = 'claim_pair'
			LIMIT 5000`
		).catch(() => []),
		query<ClaimRow[]>(
			`SELECT
				id,
				text,
				claim_type,
				domain,
				confidence,
				position_in_source,
				passage_role,
				review_state,
				verification_state,
				source_span_start,
				source_span_end,
				source.{id, title} AS source
			FROM claim
			WHERE review_state IN ['candidate', 'needs_review']
			ORDER BY source ASC, position_in_source ASC, id ASC
			LIMIT $limit`,
			{ limit: duplicateCandidateLimit }
		),
		...REVIEWABLE_RELATION_TABLES.map(async (table) => {
			const [counts, rows] = await Promise.all([
				query<CountRow[]>(`SELECT review_state, count() AS count FROM ${table} GROUP BY review_state`).catch(
					() => []
				),
				query<RelationRow[]>(
					`SELECT
						id,
						strength,
						note,
						relation_confidence,
						relation_inference_mode,
						review_state,
						verification_state,
						evidence_passages,
						review_notes,
						reviewed_at,
						reviewed_by,
						in.{id, text, position_in_source, review_state, verification_state, source.{id, title}} AS from_claim,
						out.{id, text, position_in_source, review_state, verification_state, source.{id, title}} AS to_claim
					FROM ${table}
					WHERE review_state IN ['candidate', 'needs_review']
					ORDER BY review_state DESC, relation_confidence ASC, id ASC
					LIMIT $limit`,
					{ limit }
				).catch(() => [])
			]);
			return { table, counts, rows };
		})
	]);

	const claimCounts = mergeCounts(emptyCounts(), claimCountRows);
	let relationCounts = emptyCounts();
	const relationQueue = relationResults
		.flatMap(({ table, rows, counts }) => {
			relationCounts = mergeCounts(relationCounts, counts);
			return rows.map((row) => normalizeRelationRow(table, row));
		})
		.sort((left, right) => {
			if (left.review_state !== right.review_state) {
				return left.review_state === 'needs_review' ? -1 : 1;
			}
			return (left.relation_confidence ?? 1) - (right.relation_confidence ?? 1);
		})
		.slice(0, limit);

	const claimQueue = claimQueueRows
		.map(normalizeClaimRow)
		.sort((left, right) => {
			if (left.review_state !== right.review_state) {
				return left.review_state === 'needs_review' ? -1 : 1;
			}
			return left.confidence - right.confidence;
		})
		.slice(0, limit);

	const assessedPairs = new Set(pairAuditRows.map((row) => row.entity_id));
	const duplicateSuggestions: DuplicateSuggestion[] = [];
	const duplicateClaims = duplicateClaimRows.map(normalizeClaimRow);
	for (let i = 0; i < duplicateClaims.length; i++) {
		for (let j = i + 1; j < duplicateClaims.length; j++) {
			const left = duplicateClaims[i];
			const right = duplicateClaims[j];
			const key = pairKey(left.id, right.id);
			if (assessedPairs.has(key)) continue;
			const suggestion = suggestDuplicateClassification(left, right);
			if (!suggestion) continue;
			const canonical = selectCanonicalClaim(left, right);
			duplicateSuggestions.push({
				pair_key: key,
				left,
				right,
				suggested_classification: suggestion.classification,
				recommended_canonical_claim_id: canonical.id,
				score: suggestion.score,
				reason: suggestion.reason
			});
		}
	}

	duplicateSuggestions.sort((left, right) => right.score - left.score);

	return {
		trustedGraphActive: claimCounts.accepted > 0,
		claimCounts,
		relationCounts,
		claimQueue,
		relationQueue,
		duplicateSuggestions: duplicateSuggestions.slice(0, 12),
		recentAudit
	};
}
