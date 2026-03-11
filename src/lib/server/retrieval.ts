/**
 * SOPHIA — Dialectical Retrieval v2
 *
 * Retrieval v2 pipeline:
 *   1. Embed query
 *   2. KNN seed pool + MMR diversification
 *   3. Beam traversal with edge priors + confidence weighting + fixed hop decay
 *   4. Closure enforcement (thesis -> objection -> reply)
 *   5. Batch relation + argument assembly
 *   6. Provenance-rich result + traversal trace
 *
 * Graceful degradation: never throws — returns empty/degraded result on failures.
 */

import { isDatabaseUnavailable, query } from './db';
import { embedQuery } from './embeddings';
import type { PhilosophicalDomain } from './types';

// ─── Retrieval constants (tunable defaults) ───────────────────────────────

const ALLOWED_RELATION_TYPES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'refines',
	'exemplifies'
] as const;

type AllowedRelationType = (typeof ALLOWED_RELATION_TYPES)[number];

const EDGE_PRIOR: Record<AllowedRelationType, number> = {
	supports: 1.0,
	contradicts: 0.92,
	responds_to: 0.95,
	depends_on: 0.86,
	refines: 0.82,
	exemplifies: 0.76
};

const EDGE_STRENGTH_WEIGHT: Record<string, number> = {
	strong: 1.0,
	moderate: 0.82,
	weak: 0.65
};

const MMR_LAMBDA = Number(process.env.RETRIEVAL_MMR_LAMBDA || '0.72');
const HOP_DECAY = Number(process.env.RETRIEVAL_HOP_DECAY || '0.82');

// ─── Result interfaces ─────────────────────────────────────────────────────

export interface ClaimProvenance {
	source_span?: string | null;
	source_offset_start?: number | null;
	source_offset_end?: number | null;
	bibliographic_identity: {
		title: string;
		author: string[];
		year?: number | null;
		source_type?: string | null;
		url?: string | null;
	};
	ingest_version?: string | null;
}

export interface RetrievedClaim {
	id: string;
	text: string;
	claim_type: string;
	domain: PhilosophicalDomain;
	source_title: string;
	source_author: string[];
	confidence: number;
	position_in_source: number;
	provenance: ClaimProvenance;
}

export interface RelationProvenance {
	edge_type: AllowedRelationType;
	from_claim_id: string;
	to_claim_id: string;
	edge_prior: number;
	edge_confidence_weight: number;
	hop_decay_factor: number;
	ingest_version?: string | null;
}

export interface RetrievedRelation {
	from_index: number;
	to_index: number;
	relation_type: AllowedRelationType;
	strength?: string;
	note?: string;
	confidence_weight: number;
	weighted_score: number;
	hop?: number;
	provenance: RelationProvenance;
}

export interface RetrievedArgument {
	id: string;
	name: string;
	tradition: string | null;
	domain: PhilosophicalDomain;
	summary: string;
	conclusion_text: string | null;
	key_premises: string[];
}

export type RejectedClaimReasonCode =
	| 'seed_pool_pruned'
	| 'duplicate_traversal'
	| 'confidence_gate';
export type RejectedRelationReasonCode =
	| 'duplicate_relation'
	| 'missing_endpoint';

export interface RejectedClaimCandidate {
	id: string;
	text: string;
	source_title: string;
	confidence?: number;
	reason_code: RejectedClaimReasonCode;
	considered_in: 'seed_pool' | 'traversal';
	anchor_claim_id?: string;
}

export interface RejectedRelationCandidate {
	from_claim_id: string;
	to_claim_id: string;
	relation_type: string;
	reason_code: RejectedRelationReasonCode;
	strength?: string;
	note?: string;
}

export interface RetrievalTraceStep {
	hop: number;
	frontier_size: number;
	edge_candidates: number;
	neighbor_candidates: number;
	selected_neighbors: number;
	beam_width: number;
}

export interface RetrievalResult {
	claims: RetrievedClaim[];
	relations: RetrievedRelation[];
	arguments: RetrievedArgument[];
	seed_claim_ids: string[];
	trace?: {
		seed_pool_count: number;
		selected_seed_count: number;
		traversed_claim_count: number;
		relation_candidate_count: number;
		relation_kept_count: number;
		argument_candidate_count: number;
		argument_kept_count: number;
		rejected_claims?: RejectedClaimCandidate[];
		rejected_relations?: RejectedRelationCandidate[];
		mmr?: {
			lambda: number;
			seed_pool_size: number;
			top_k: number;
		};
		traversal_steps?: RetrievalTraceStep[];
		closure?: {
			thesis_checked: number;
			objections_added: number;
			replies_added: number;
		};
	};
	degraded: boolean;
	degraded_reason?: string;
}

export interface RetrievalOptions {
	/** Number of seed claims selected after MMR (default: 6) */
	topK?: number;
	/** Filter by philosophical domain */
	domain?: PhilosophicalDomain;
	/** Minimum confidence threshold for claims (default: 0) */
	minConfidence?: number;
	/** Graph traversal depth (hops from seed claims) */
	maxHops?: number;
	/** Optional cap on total claims returned after traversal */
	maxClaims?: number;
	/** Beam width per hop */
	beamWidth?: number;
	/** Optional authenticated user; enables access to owner-private sources */
	viewerUid?: string | null;
}

const EMPTY_RESULT: RetrievalResult = {
	claims: [],
	relations: [],
	arguments: [],
	seed_claim_ids: [],
	degraded: false
};

// ─── Internal types ────────────────────────────────────────────────────────

type SeedRow = {
	id: string;
	text: string;
	claim_type: string;
	domain: PhilosophicalDomain;
	confidence: number;
	position_in_source: number;
	section_context: string | null;
	source_span?: string | null;
	source_offset_start?: number | null;
	source_offset_end?: number | null;
	source_title: string;
	source_author: string[];
	source_year?: number | null;
	source_type?: string | null;
	source_url?: string | null;
	source_ingested_at?: string | null;
	embedding?: number[] | null;
};

type BeamNode = {
	claim_id: string;
	score: number;
	hop: number;
};

type RelationEdgeRow = {
	in: string;
	out: string;
	relation_type: AllowedRelationType;
	strength?: string;
	note?: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function toId(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
		return String((value as Record<string, unknown>).id);
	}
	return String(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function cosineSimilarity(a?: number[] | null, b?: number[] | null): number {
	if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const ai = a[i] ?? 0;
		const bi = b[i] ?? 0;
		dot += ai * bi;
		normA += ai * ai;
		normB += bi * bi;
	}
	if (normA <= 0 || normB <= 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function edgeStrengthWeight(strength?: string): number {
	if (!strength) return 0.75;
	return EDGE_STRENGTH_WEIGHT[strength] ?? 0.75;
}

function toRetrievedClaim(seed: SeedRow): RetrievedClaim {
	return {
		id: toId(seed.id),
		text: seed.text,
		claim_type: seed.claim_type,
		domain: seed.domain,
		source_title: seed.source_title ?? 'Unknown',
		source_author: seed.source_author ?? [],
		confidence: seed.confidence ?? 0.5,
		position_in_source: seed.position_in_source ?? 0,
		provenance: {
			source_span: seed.source_span ?? seed.section_context ?? null,
			source_offset_start: seed.source_offset_start ?? null,
			source_offset_end: seed.source_offset_end ?? null,
			bibliographic_identity: {
				title: seed.source_title ?? 'Unknown',
				author: seed.source_author ?? [],
				year: seed.source_year ?? null,
				source_type: seed.source_type ?? null,
				url: seed.source_url ?? null
			},
			ingest_version: seed.source_ingested_at ?? null
		}
	};
}

function selectSeedsWithMMR(seedPool: SeedRow[], topK: number, queryEmbedding: number[]): SeedRow[] {
	if (seedPool.length <= 1) return seedPool.slice(0, topK);

	const selected: SeedRow[] = [];
	const candidates = [...seedPool];
	const relevance = new Map<string, number>();

	for (let i = 0; i < candidates.length; i++) {
		const c = candidates[i];
		const rid = toId(c.id);
		const rankFallback = 1 - i / Math.max(candidates.length, 1);
		const rel = c.embedding ? cosineSimilarity(queryEmbedding, c.embedding) : rankFallback;
		relevance.set(rid, rel);
	}

	while (selected.length < topK && candidates.length > 0) {
		let bestIndex = 0;
		let bestScore = Number.NEGATIVE_INFINITY;

		for (let i = 0; i < candidates.length; i++) {
			const candidate = candidates[i];
			const candidateId = toId(candidate.id);
			const rel = relevance.get(candidateId) ?? 0;

			let diversityPenalty = 0;
			for (const picked of selected) {
				const sim = cosineSimilarity(candidate.embedding, picked.embedding);
				if (sim > diversityPenalty) diversityPenalty = sim;
			}

			const score = MMR_LAMBDA * rel - (1 - MMR_LAMBDA) * diversityPenalty;
			if (score > bestScore) {
				bestScore = score;
				bestIndex = i;
			}
		}

		selected.push(candidates[bestIndex]);
		candidates.splice(bestIndex, 1);
	}

	return selected;
}

async function fetchRelationsConnectedToFrontier(frontierIds: string[]): Promise<RelationEdgeRow[]> {
	if (frontierIds.length === 0) return [];
	const rows: RelationEdgeRow[] = [];

	for (const table of ALLOWED_RELATION_TYPES) {
		type RawRel = { in: string; out: string; strength?: string; note?: string };
		const rels = await query<RawRel[]>(
			`SELECT in, out, strength, note
			 FROM ${table}
			 WHERE in INSIDE $frontier_ids OR out INSIDE $frontier_ids`,
			{ frontier_ids: frontierIds }
		);
		if (!rels || !Array.isArray(rels)) continue;
		for (const rel of rels) {
			rows.push({
				in: toId(rel.in),
				out: toId(rel.out),
				relation_type: table,
				strength: rel.strength,
				note: rel.note
			});
		}
	}

	return rows;
}

async function fetchClaimsByIds(ids: string[], viewerUid: string | null = null): Promise<SeedRow[]> {
	if (ids.length === 0) return [];

	const visibilityClause = viewerUid
		? "(source.visibility_scope = NONE OR source.visibility_scope = 'public_shared' OR (source.visibility_scope = 'private_user_only' AND source.owner_uid = $viewer_uid))"
		: "(source.visibility_scope = NONE OR source.visibility_scope = 'public_shared')";

	return query<SeedRow[]>(
		`SELECT
			id,
			text,
			claim_type,
			domain,
			confidence,
			position_in_source,
			section_context,
			source_span,
			source_offset_start,
			source_offset_end,
			source.title AS source_title,
			source.author AS source_author,
			source.year AS source_year,
			source.source_type AS source_type,
			source.url AS source_url,
			source.ingested_at AS source_ingested_at,
			embedding
		 FROM claim
		 WHERE id INSIDE $ids
		   AND ${visibilityClause}`,
		{ ids, viewer_uid: viewerUid }
	);
}

async function enforceDialecticalClosure(params: {
	claimsById: Map<string, RetrievedClaim>;
	relationRows: RelationEdgeRow[];
	maxClaims: number;
	viewerUid: string | null;
}): Promise<{ objectionsAdded: number; repliesAdded: number }> {
	const { claimsById, relationRows, maxClaims, viewerUid } = params;
	let objectionsAdded = 0;
	let repliesAdded = 0;

	const isPresent = (id: string): boolean => claimsById.has(id);
	const claimType = (id: string): string | undefined => claimsById.get(id)?.claim_type;

	const thesisIds = [...claimsById.values()]
		.filter((claim) => claim.claim_type === 'thesis')
		.map((claim) => claim.id)
		.slice(0, 4);

	for (const thesisId of thesisIds) {
		if (claimsById.size >= maxClaims) break;

		const hasObjection = relationRows.some((edge) => {
			if (edge.relation_type !== 'contradicts' && edge.relation_type !== 'responds_to') return false;
			if (edge.in !== thesisId && edge.out !== thesisId) return false;
			const other = edge.in === thesisId ? edge.out : edge.in;
			return claimType(other) === 'objection';
		});

		if (!hasObjection) {
			const objectionEdges = await query<RelationEdgeRow[]>(
				`SELECT in, out, 'contradicts' AS relation_type, strength, note
				 FROM contradicts
				 WHERE in = $thesis OR out = $thesis
				 LIMIT 8`,
				{ thesis: thesisId }
			);

			const objectionIds = new Set<string>();
			for (const edge of objectionEdges ?? []) {
				const inId = toId(edge.in);
				const outId = toId(edge.out);
				const other = inId === thesisId ? outId : outId === thesisId ? inId : null;
				if (!other) continue;
				objectionIds.add(other);
				relationRows.push({
					in: inId,
					out: outId,
					relation_type: 'contradicts',
					strength: edge.strength,
					note: edge.note
				});
			}

			const objectionClaims = await fetchClaimsByIds([...objectionIds], viewerUid);
			for (const candidate of objectionClaims) {
				if (claimsById.size >= maxClaims) break;
				if (candidate.claim_type !== 'objection') continue;
				const cid = toId(candidate.id);
				if (isPresent(cid)) continue;
				claimsById.set(cid, toRetrievedClaim(candidate));
				objectionsAdded++;
				break;
			}
		}

		const objectionLinks = relationRows.filter((edge) => {
			if (edge.relation_type !== 'contradicts' && edge.relation_type !== 'responds_to') return false;
			if (edge.in !== thesisId && edge.out !== thesisId) return false;
			const other = edge.in === thesisId ? edge.out : edge.in;
			return claimType(other) === 'objection';
		});

		for (const objectionEdge of objectionLinks) {
			if (claimsById.size >= maxClaims) break;
			const objectionId = objectionEdge.in === thesisId ? objectionEdge.out : objectionEdge.in;

			const hasReply = relationRows.some((edge) => {
				if (edge.relation_type !== 'responds_to') return false;
				if (edge.in !== objectionId && edge.out !== objectionId) return false;
				const other = edge.in === objectionId ? edge.out : edge.in;
				return claimType(other) === 'response';
			});
			if (hasReply) continue;

			const replyEdges = await query<RelationEdgeRow[]>(
				`SELECT in, out, 'responds_to' AS relation_type, strength, note
				 FROM responds_to
				 WHERE in = $objection OR out = $objection
				 LIMIT 8`,
				{ objection: objectionId }
			);

			const replyIds = new Set<string>();
			for (const edge of replyEdges ?? []) {
				const inId = toId(edge.in);
				const outId = toId(edge.out);
				const other = inId === objectionId ? outId : outId === objectionId ? inId : null;
				if (!other) continue;
				replyIds.add(other);
				relationRows.push({
					in: inId,
					out: outId,
					relation_type: 'responds_to',
					strength: edge.strength,
					note: edge.note
				});
			}

			const replyClaims = await fetchClaimsByIds([...replyIds], viewerUid);
			for (const candidate of replyClaims) {
				if (claimsById.size >= maxClaims) break;
				if (candidate.claim_type !== 'response') continue;
				const cid = toId(candidate.id);
				if (isPresent(cid)) continue;
				claimsById.set(cid, toRetrievedClaim(candidate));
				repliesAdded++;
				break;
			}
		}
	}

	return { objectionsAdded, repliesAdded };
}

function buildRelationObjects(params: {
	relationRows: RelationEdgeRow[];
	claims: RetrievedClaim[];
	beamScores: Map<string, { score: number; hop: number }>;
}): {
	relations: RetrievedRelation[];
	relationCandidateCount: number;
	rejectedRelations: RejectedRelationCandidate[];
} {
	const { relationRows, claims, beamScores } = params;
	const relationCandidateCount = relationRows.length;
	const rejectedRelations: RejectedRelationCandidate[] = [];

	const claimIdToIndex = new Map<string, number>();
	for (let i = 0; i < claims.length; i++) claimIdToIndex.set(claims[i].id, i);

	const kept = new Set<string>();
	const relations: RetrievedRelation[] = [];

	for (const edge of relationRows) {
		const fromId = toId(edge.in);
		const toClaimId = toId(edge.out);
		const fromIdx = claimIdToIndex.get(fromId);
		const toIdx = claimIdToIndex.get(toClaimId);
		if (fromIdx === undefined || toIdx === undefined) {
			rejectedRelations.push({
				from_claim_id: fromId,
				to_claim_id: toClaimId,
				relation_type: edge.relation_type,
				reason_code: 'missing_endpoint',
				strength: edge.strength,
				note: edge.note
			});
			continue;
		}

		const dedupeKey = `${fromIdx}|${toIdx}|${edge.relation_type}`;
		if (kept.has(dedupeKey)) {
			rejectedRelations.push({
				from_claim_id: fromId,
				to_claim_id: toClaimId,
				relation_type: edge.relation_type,
				reason_code: 'duplicate_relation',
				strength: edge.strength,
				note: edge.note
			});
			continue;
		}
		kept.add(dedupeKey);

		const prior = EDGE_PRIOR[edge.relation_type] ?? 0.7;
		const edgeConf = edgeStrengthWeight(edge.strength);
		const fromBeam = beamScores.get(fromId);
		const toBeam = beamScores.get(toClaimId);
		const hop = Math.max(fromBeam?.hop ?? 0, toBeam?.hop ?? 0);
		const decay = Math.pow(HOP_DECAY, hop);
		const weightedScore = clamp(
			Math.max(fromBeam?.score ?? 0.4, toBeam?.score ?? 0.4) * prior * edgeConf * decay,
			0,
			1.5
		);

		relations.push({
			from_index: fromIdx,
			to_index: toIdx,
			relation_type: edge.relation_type,
			strength: edge.strength,
			note: edge.note,
			confidence_weight: edgeConf,
			weighted_score: weightedScore,
			hop,
			provenance: {
				edge_type: edge.relation_type,
				from_claim_id: fromId,
				to_claim_id: toClaimId,
				edge_prior: prior,
				edge_confidence_weight: edgeConf,
				hop_decay_factor: decay,
				ingest_version:
					claims[fromIdx]?.provenance?.ingest_version ??
					claims[toIdx]?.provenance?.ingest_version ??
					null
			}
		});
	}

	return { relations, relationCandidateCount, rejectedRelations };
}

async function fetchArgumentsForClaims(claimIds: string[]): Promise<RetrievedArgument[]> {
	if (claimIds.length === 0) return [];

	type PartOfRow = { in: string; out: string; role: string; claim_text?: string };
	type ArgRow = {
		id: string;
		name: string;
		tradition: string | null;
		domain: PhilosophicalDomain;
		summary: string;
	};

	const partOfRows = await query<PartOfRow[]>(
		`SELECT in, out, role, in.text AS claim_text
		 FROM part_of
		 WHERE in INSIDE $claim_ids`,
		{ claim_ids: claimIds }
	);

	const argumentIds = [...new Set((partOfRows ?? []).map((row) => toId(row.out)))];
	if (argumentIds.length === 0) return [];

	const argRows = await query<ArgRow[]>(
		`SELECT id, name, tradition, domain, summary
		 FROM argument
		 WHERE id INSIDE $arg_ids`,
		{ arg_ids: argumentIds }
	);
	if (!argRows || argRows.length === 0) return [];

	const byArgId = new Map<string, PartOfRow[]>();
	for (const row of partOfRows ?? []) {
		const argId = toId(row.out);
		if (!byArgId.has(argId)) byArgId.set(argId, []);
		byArgId.get(argId)?.push(row);
	}

	const arguments_: RetrievedArgument[] = [];
	for (const arg of argRows) {
		const argId = toId(arg.id);
		const members = byArgId.get(argId) ?? [];
		let conclusionText: string | null = null;
		const keyPremises: string[] = [];

		for (const member of members) {
			if (member.role === 'conclusion' && member.claim_text) {
				conclusionText = member.claim_text;
			} else if (member.role === 'key_premise' && member.claim_text) {
				keyPremises.push(member.claim_text);
			}
		}

		arguments_.push({
			id: argId,
			name: arg.name,
			tradition: arg.tradition,
			domain: arg.domain,
			summary: arg.summary,
			conclusion_text: conclusionText,
			key_premises: keyPremises
		});
	}

	return arguments_;
}

// ─── Main retrieval function ───────────────────────────────────────────────

export async function retrieveContext(
	userQuery: string,
	options: RetrievalOptions = {}
): Promise<RetrievalResult> {
	const { topK = 6, domain, minConfidence = 0, maxHops = 2, maxClaims, beamWidth, viewerUid = null } = options;
	const traversalMaxHops = Math.max(1, maxHops);
	const traversalClaimCap = Math.max(topK, maxClaims ?? (topK >= 10 ? 140 : topK <= 3 ? 36 : 86));
	const traversalBeamWidth = Math.max(3, beamWidth ?? Math.min(18, topK * 2));

	try {
		let queryEmbedding: number[];
		try {
			queryEmbedding = await embedQuery(userQuery);
		} catch (err) {
			console.error('[RETRIEVAL] Embedding failed:', err instanceof Error ? err.message : err);
			return {
				...EMPTY_RESULT,
				degraded: true,
				degraded_reason: 'embedding_unavailable'
			};
		}

		const knnPool = Math.max(topK * 5, topK + 6);
		const filters: string[] = [];
		if (domain) filters.push('domain = $domain');
		if (minConfidence > 0) filters.push('confidence >= $minConfidence');
		filters.push(
			viewerUid
				? "(source.visibility_scope = NONE OR source.visibility_scope = 'public_shared' OR (source.visibility_scope = 'private_user_only' AND source.owner_uid = $viewer_uid))"
				: "(source.visibility_scope = NONE OR source.visibility_scope = 'public_shared')"
		);
		const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

		let seedPool: SeedRow[];
		try {
			seedPool = await query<SeedRow[]>(
				`SELECT
					id,
					text,
					claim_type,
					domain,
					confidence,
					position_in_source,
					section_context,
					source_span,
					source_offset_start,
					source_offset_end,
					source.title AS source_title,
					source.author AS source_author,
					source.year AS source_year,
					source.source_type AS source_type,
					source.url AS source_url,
					source.ingested_at AS source_ingested_at,
					embedding
				FROM (
					SELECT *
					FROM claim
					WHERE embedding <|${knnPool}|> $query_embedding
				)
				${whereClause}
				LIMIT ${knnPool}`,
				{
					query_embedding: queryEmbedding,
					...(domain ? { domain } : {}),
					...(minConfidence > 0 ? { minConfidence } : {}),
					viewer_uid: viewerUid
				}
			);
		} catch (dbErr) {
			if (isDatabaseUnavailable(dbErr)) {
				return {
					...EMPTY_RESULT,
					degraded: true,
					degraded_reason: 'database_unavailable'
				};
			}
			throw dbErr;
		}

		if (!seedPool || seedPool.length === 0) return EMPTY_RESULT;

		const rejectedClaimsByKey = new Map<string, RejectedClaimCandidate>();
		const addRejectedClaim = (candidate: RejectedClaimCandidate): void => {
			const key = `${candidate.id}|${candidate.reason_code}`;
			if (rejectedClaimsByKey.has(key)) return;
			rejectedClaimsByKey.set(key, candidate);
		};

		const selectedSeeds = selectSeedsWithMMR(seedPool, topK, queryEmbedding);
		const selectedSeedIds = new Set(selectedSeeds.map((seed) => toId(seed.id)));
		for (const candidate of seedPool) {
			const id = toId(candidate.id);
			if (selectedSeedIds.has(id)) continue;
			addRejectedClaim({
				id,
				text: candidate.text,
				source_title: candidate.source_title ?? 'Unknown',
				confidence: candidate.confidence,
				reason_code: 'seed_pool_pruned',
				considered_in: 'seed_pool'
			});
		}

		const claimsById = new Map<string, RetrievedClaim>();
		const beamScores = new Map<string, { score: number; hop: number }>();
		let frontier: BeamNode[] = [];

		for (let i = 0; i < selectedSeeds.length; i++) {
			const seed = selectedSeeds[i];
			const claim = toRetrievedClaim(seed);
			const rel = seed.embedding ? cosineSimilarity(queryEmbedding, seed.embedding) : 1 - i / selectedSeeds.length;
			const score = clamp(rel * clamp(seed.confidence ?? 0.5, 0.35, 1), 0, 1);

			claimsById.set(claim.id, claim);
			beamScores.set(claim.id, { score, hop: 0 });
			frontier.push({ claim_id: claim.id, score, hop: 0 });
		}

		const traversalSteps: RetrievalTraceStep[] = [];
		const rejectedRelations: RejectedRelationCandidate[] = [];
		const relationRows: RelationEdgeRow[] = [];

		for (let hop = 1; hop <= traversalMaxHops; hop++) {
			if (frontier.length === 0 || claimsById.size >= traversalClaimCap) break;

			const frontierIds = frontier.map((n) => n.claim_id);
			let edgeCandidates: RelationEdgeRow[] = [];
			try {
				edgeCandidates = await fetchRelationsConnectedToFrontier(frontierIds);
			} catch (err) {
				console.warn('[RETRIEVAL] batch neighbor fetch failed:', err instanceof Error ? err.message : err);
				break;
			}

			const neighborScoreById = new Map<
				string,
				{ score: number; edge: RelationEdgeRow; parentId: string; hop: number }
			>();

			for (const edge of edgeCandidates) {
				if (!ALLOWED_RELATION_TYPES.includes(edge.relation_type)) continue;

				const inId = toId(edge.in);
				const outId = toId(edge.out);
				const inFrontier = frontierIds.includes(inId);
				const outFrontier = frontierIds.includes(outId);

				if (!inFrontier && !outFrontier) continue;
				if (inFrontier && outFrontier) {
					relationRows.push(edge);
					continue;
				}

				const parentId = inFrontier ? inId : outId;
				const neighborId = inFrontier ? outId : inId;
				relationRows.push(edge);
				if (claimsById.has(neighborId)) continue;

				const parentScore = beamScores.get(parentId)?.score ?? 0.4;
				const prior = EDGE_PRIOR[edge.relation_type] ?? 0.7;
				const edgeConf = edgeStrengthWeight(edge.strength);
				const weighted = clamp(parentScore * Math.pow(HOP_DECAY, hop) * prior * edgeConf, 0, 1.5);

				const existing = neighborScoreById.get(neighborId);
				if (!existing || weighted > existing.score) {
					neighborScoreById.set(neighborId, {
						score: weighted,
						edge,
						parentId,
						hop
					});
				}
			}

			const candidateNeighborIds = [...neighborScoreById.keys()];
			const missingClaimRows = await fetchClaimsByIds(candidateNeighborIds, viewerUid);
			const claimRowById = new Map<string, SeedRow>();
			for (const row of missingClaimRows) claimRowById.set(toId(row.id), row);

			const scoredNeighbors: Array<{ id: string; score: number; hop: number; parentId: string }> = [];
			for (const [neighborId, candidate] of neighborScoreById.entries()) {
				const row = claimRowById.get(neighborId);
				if (!row) continue;

				const confWeight = clamp(row.confidence ?? 0.5, 0.35, 1);
				const score = candidate.score * confWeight;
				if (score < 0.08) {
					addRejectedClaim({
						id: neighborId,
						text: row.text,
						source_title: row.source_title ?? 'Unknown',
						confidence: row.confidence,
						reason_code: 'confidence_gate',
						considered_in: 'traversal',
						anchor_claim_id: candidate.parentId
					});
					continue;
				}

				scoredNeighbors.push({
					id: neighborId,
					score,
					hop: hop,
					parentId: candidate.parentId
				});
			}

			scoredNeighbors.sort((a, b) => b.score - a.score);
			const hopBudget = Math.min(
				traversalBeamWidth,
				Math.max(0, traversalClaimCap - claimsById.size)
			);
			const selectedNeighbors = scoredNeighbors.slice(0, hopBudget);

			frontier = [];
			for (const selected of selectedNeighbors) {
				const row = claimRowById.get(selected.id);
				if (!row) continue;
				claimsById.set(selected.id, toRetrievedClaim(row));
				beamScores.set(selected.id, { score: selected.score, hop: selected.hop });
				frontier.push({ claim_id: selected.id, score: selected.score, hop: selected.hop });
			}

			traversalSteps.push({
				hop,
				frontier_size: frontierIds.length,
				edge_candidates: edgeCandidates.length,
				neighbor_candidates: scoredNeighbors.length,
				selected_neighbors: selectedNeighbors.length,
				beam_width: traversalBeamWidth
			});
		}

		const closure = await enforceDialecticalClosure({
			claimsById,
			relationRows,
			maxClaims: traversalClaimCap,
			viewerUid
		});

		const claims = [...claimsById.values()].sort((a, b) => {
			const aSeed = selectedSeedIds.has(a.id) ? 0 : 1;
			const bSeed = selectedSeedIds.has(b.id) ? 0 : 1;
			if (aSeed !== bSeed) return aSeed - bSeed;
			return (b.confidence ?? 0) - (a.confidence ?? 0);
		});

		const relationBundle = buildRelationObjects({ relationRows, claims, beamScores });
		rejectedRelations.push(...relationBundle.rejectedRelations);

		const arguments_ = await fetchArgumentsForClaims(claims.map((claim) => claim.id));

		return {
			claims,
			relations: relationBundle.relations,
			arguments: arguments_,
			seed_claim_ids: selectedSeeds.map((seed) => toId(seed.id)),
			trace: {
				seed_pool_count: seedPool.length,
				selected_seed_count: selectedSeeds.length,
				traversed_claim_count: Math.max(claims.length - selectedSeeds.length, 0),
				relation_candidate_count: relationBundle.relationCandidateCount,
				relation_kept_count: relationBundle.relations.length,
				argument_candidate_count: arguments_.length,
				argument_kept_count: arguments_.length,
				rejected_claims: [...rejectedClaimsByKey.values()].slice(0, 80),
				rejected_relations: rejectedRelations.slice(0, 120),
				mmr: {
					lambda: MMR_LAMBDA,
					seed_pool_size: seedPool.length,
					top_k: topK
				},
				traversal_steps: traversalSteps,
				closure: {
					thesis_checked: claims.filter((claim) => claim.claim_type === 'thesis').length,
					objections_added: closure.objectionsAdded,
					replies_added: closure.repliesAdded
				}
			},
			degraded: false
		};
	} catch (err) {
		console.error(
			'[RETRIEVAL] Fatal retrieval error (returning empty result):',
			err instanceof Error ? err.message : err
		);
		return {
			...EMPTY_RESULT,
			degraded: true,
			degraded_reason: isDatabaseUnavailable(err) ? 'database_unavailable' : 'retrieval_error'
		};
	}
}

// ─── Context block formatter ───────────────────────────────────────────────

export function buildContextBlock(result: RetrievalResult): string {
	if (!result.claims || result.claims.length === 0) {
		return 'No knowledge base context available for this query.';
	}

	const lines: string[] = [];

	lines.push('=== PHILOSOPHICAL KNOWLEDGE GRAPH CONTEXT ===');
	lines.push('');
	lines.push(
		'The following are structured claims from SOPHIA\'s curated philosophical knowledge graph. ' +
			'Use these as your philosophical foundation, with relation types and provenance metadata.'
	);
	lines.push('');

	for (let i = 0; i < result.claims.length; i++) {
		const c = result.claims[i];
		const claimId = `c:${String(i + 1).padStart(3, '0')}`;
		const bibliographic = c.provenance?.bibliographic_identity;
		const bibParts = [
			bibliographic?.title,
			bibliographic?.year ? String(bibliographic.year) : null,
			bibliographic?.source_type ?? null
		].filter(Boolean);
		lines.push(`CLAIM [${claimId}] (${c.claim_type})`);
		lines.push(`"${c.text}"`);
		lines.push(
			`  provenance: ${bibParts.length > 0 ? bibParts.join(' | ') : c.source_title}; ingest_version=${c.provenance?.ingest_version ?? 'unknown'}`
		);

		const outgoingRelations = result.relations.filter((r) => r.from_index === i);
		if (outgoingRelations.length > 0) {
			for (const r of outgoingRelations) {
				const targetId = `c:${String(r.to_index + 1).padStart(3, '0')}`;
				const relType = r.relation_type.toUpperCase().replace(/_/g, ' ');
				lines.push(
					`  -> ${relType} [${targetId}] (score=${r.weighted_score.toFixed(2)}, confidence=${r.confidence_weight.toFixed(2)})`
				);
			}
		}
		lines.push('');
	}

	if (result.arguments.length > 0) {
		lines.push('NAMED ARGUMENTS:');
		for (const arg of result.arguments) {
			const traditionStr = arg.tradition ? ` (${arg.tradition})` : '';
			lines.push(`▸ ${arg.name}${traditionStr}`);
			lines.push(`  ${arg.summary}`);
			if (arg.conclusion_text) {
				lines.push(`  Conclusion: "${arg.conclusion_text}"`);
			}
			if (arg.key_premises.length > 0) {
				lines.push(`  Key premises: ${arg.key_premises.map((p) => `"${p}"`).join('; ')}`);
			}
			lines.push('');
		}
	}

	if (result.trace?.traversal_steps && result.trace.traversal_steps.length > 0) {
		lines.push('RETRIEVAL TRACE:');
		for (const step of result.trace.traversal_steps) {
			lines.push(
				`  hop ${step.hop}: frontier=${step.frontier_size}, edges=${step.edge_candidates}, candidates=${step.neighbor_candidates}, selected=${step.selected_neighbors}, beam=${step.beam_width}`
			);
		}
		if (result.trace.closure) {
			lines.push(
				`  closure: thesis_checked=${result.trace.closure.thesis_checked}, objections_added=${result.trace.closure.objections_added}, replies_added=${result.trace.closure.replies_added}`
			);
		}
		lines.push('');
	}

	lines.push('=== END KNOWLEDGE GRAPH CONTEXT ===');
	lines.push('');
	lines.push('Use grounding search to verify, challenge, or extend these claims with current sources.');

	return lines.join('\n');
}
