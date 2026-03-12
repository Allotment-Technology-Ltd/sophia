/**
 * SOPHIA — Argument-Aware Retrieval
 *
 * Core differentiator: not just semantic similarity, but graph traversal
 * that assembles complete argumentative chains from the knowledge graph.
 *
 * Retrieval pipeline:
 *   1. Embed query via Voyage AI
 *   2. Vector search for top-K semantically similar claims
 *   3. Graph traversal for each seed claim (depends_on, supports, contradicts, responds_to, defines, qualifies, part_of)
 *   4. Deduplicate claims
 *   5. Resolve inter-claim relations
 *   6. Fetch argument structure (conclusion + key premises)
 *   7. Return assembled RetrievalResult
 *
 * Graceful degradation: never throws — returns empty result on any failure
 * so the three-pass engine can still work without the graph.
 */

import { isDatabaseUnavailable, query } from './db';
import { embedQuery } from './embeddings';
import type { PhilosophicalDomain } from './types';

// ─── Result interfaces ─────────────────────────────────────────────────────

export interface RetrievedClaim {
	id: string;
	text: string;
	claim_type: string;
	domain: PhilosophicalDomain;
	source_title: string;
	source_author: string[];
	confidence: number;
	position_in_source: number;
}

export interface RetrievedRelation {
	from_index: number;
	to_index: number;
	relation_type: string;
	strength?: string;
	note?: string;
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
	| 'confidence_gate'
	| 'source_integrity_gate';
export type RejectedRelationReasonCode = 'duplicate_relation' | 'missing_endpoint';

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
	};
	degraded: boolean;
	degraded_reason?: string;
}

export interface RetrievalOptions {
	/** Number of seed claims from vector search (default: 5) */
	topK?: number;
	/** Filter by philosophical domain */
	domain?: PhilosophicalDomain;
	/** Minimum confidence threshold for claims (default: 0) */
	minConfidence?: number;
	/** Optional override for graph traversal depth (hops from seed claims) */
	maxHops?: number;
	/** Optional cap on total claims returned after traversal */
	maxClaims?: number;
}

const EMPTY_RESULT: RetrievalResult = {
	claims: [],
	relations: [],
	arguments: [],
	seed_claim_ids: [],
	degraded: false
};

const RELATION_TRAVERSAL_SPECS = [
	{ incoming: 'depends_on_incoming_claims', outgoing: 'depends_on_outgoing_claims' },
	{ incoming: 'supporting_incoming_claims', outgoing: 'supporting_outgoing_claims' },
	{ incoming: 'contradicting_incoming_claims', outgoing: 'contradicting_outgoing_claims' },
	{ incoming: 'responds_to_incoming_claims', outgoing: 'responds_to_outgoing_claims' },
	{ incoming: 'defining_incoming_claims', outgoing: 'defining_outgoing_claims' },
	{ incoming: 'qualifying_incoming_claims', outgoing: 'qualifying_outgoing_claims' },
	{ incoming: 'refining_incoming_claims', outgoing: 'refining_outgoing_claims' },
	{ incoming: 'exemplifying_incoming_claims', outgoing: 'exemplifying_outgoing_claims' }
] as const;

const RELATION_FETCH_SPECS = [
	{ table: 'supports', relationType: 'supports' },
	{ table: 'contradicts', relationType: 'contradicts' },
	{ table: 'depends_on', relationType: 'depends_on' },
	{ table: 'responds_to', relationType: 'responds_to' },
	{ table: 'defines', relationType: 'defines' },
	{ table: 'qualifies', relationType: 'qualifies' },
	{ table: 'refines', relationType: 'qualifies' },
	{ table: 'exemplifies', relationType: 'supports' }
] as const;

// ─── Main retrieval function ───────────────────────────────────────────────

/**
 * Retrieve structured philosophical context from the argument graph.
 *
 * Assembles complete argumentative chains by:
 * 1. Finding semantically similar claims via vector search
 * 2. Traversing the graph for supporting/contradicting/dependent claims
 * 3. Resolving arguments those claims participate in
 *
 * Never throws — returns empty result on any failure.
 */
export async function retrieveContext(
	userQuery: string,
	options: RetrievalOptions = {}
): Promise<RetrievalResult> {
	const { topK = 5, domain, minConfidence = 0, maxHops, maxClaims } = options;
	const traversalMaxHops = Math.max(1, maxHops ?? (topK >= 10 ? 3 : topK <= 3 ? 1 : 2));
	const traversalClaimCap = Math.max(topK, maxClaims ?? (topK >= 10 ? 120 : topK <= 3 ? 32 : 72));

	try {
		// ── Step 1: Embed the query ──────────────────────────────────
		let queryEmbedding: number[];
		try {
			console.log('[RETRIEVAL] Embedding query:', userQuery.substring(0, 50) + '...');
			queryEmbedding = await embedQuery(userQuery);
			console.log('[RETRIEVAL] ✓ Query embedding received:', queryEmbedding.length, 'dimensions');
		} catch (err) {
			console.error('[RETRIEVAL] Embedding API failed:', err instanceof Error ? err.message : err);
			return {
				...EMPTY_RESULT,
				degraded: true,
				degraded_reason: 'embedding_unavailable'
			};
		}

		// ── Step 2: Vector search for seed claims ────────────────────
		// SurrealDB v2: MTREE KNN operator (<|N|>) does not support additional
		// WHERE conditions inline. Use a subquery to KNN-search a larger pool,
		// then filter/rank in the outer query.
		const knnPool = domain || minConfidence > 0 ? topK * 4 : topK;
		const acceptedClaimRows = await query<Array<{ count?: number }>>(
			`SELECT count() AS count FROM claim WHERE review_state = 'accepted' GROUP ALL`
		).catch(() => []);
		const trustedGraphActive = (acceptedClaimRows[0]?.count ?? 0) > 0;
		const claimReviewFilter = trustedGraphActive
			? `review_state = 'accepted'`
			: `(review_state = NONE OR review_state IN ['candidate', 'needs_review', 'accepted'])`;
		const relationReviewFilter = trustedGraphActive
			? `review_state = 'accepted'`
			: `(review_state = NONE OR review_state IN ['candidate', 'needs_review', 'accepted'])`;
		const argumentClaimReviewFilter = trustedGraphActive
			? `in.review_state = 'accepted'`
			: `(in.review_state = NONE OR in.review_state IN ['candidate', 'needs_review', 'accepted'])`;
		const postFilters: string[] = [];
		if (domain) postFilters.push('domain = $domain');
		if (minConfidence > 0) postFilters.push('confidence >= $minConfidence');
		postFilters.push(claimReviewFilter);
		const postWhere = postFilters.length > 0 ? `WHERE ${postFilters.join(' AND ')}` : '';

		type SeedRow = {
			id: string;
			text: string;
			claim_type: string;
			domain: PhilosophicalDomain;
			confidence: number;
			position_in_source: number;
			review_state?: string;
			section_context: string | null;
			source_id: string;
			source_title: string;
			source_author: string[];
		};

		const sourcePassageIntegrityCache = new Map<string, Promise<boolean>>();
		const sourceIdPart = (sourceId: string): string =>
			sourceId.includes(':') ? sourceId.split(':').slice(1).join(':') : sourceId;
		const sourceHasPassageCoverage = (sourceId?: string): Promise<boolean> => {
			if (!sourceId) return Promise.resolve(false);
			const existing = sourcePassageIntegrityCache.get(sourceId);
			if (existing) return existing;
			const pending = (async () => {
				const sid = sourceIdPart(sourceId);
				const passageRows = await query<Array<{ id: string }>>(
					`SELECT id FROM passage WHERE source = type::thing('source', $sid) LIMIT 1`,
					{ sid }
				).catch(() => []);
				return passageRows.length > 0;
			})();
			sourcePassageIntegrityCache.set(sourceId, pending);
			return pending;
		};

		let seedClaims: SeedRow[];
		let seedPoolCount = 0;
		const rejectedClaimsByKey = new Map<string, RejectedClaimCandidate>();
		const rejectedRelations: RejectedRelationCandidate[] = [];

		const addRejectedClaim = (candidate: RejectedClaimCandidate): void => {
			const key = `${candidate.id}|${candidate.reason_code}`;
			if (rejectedClaimsByKey.has(key)) return;
			rejectedClaimsByKey.set(key, candidate);
		};
		try {
			console.log('[RETRIEVAL] Starting vector search for topK=', topK);
			seedClaims = await query<SeedRow[]>(
				`SELECT
					id,
					text,
					claim_type,
					domain,
					confidence,
					position_in_source,
					review_state,
					section_context,
					source.id AS source_id,
					source.title AS source_title,
					source.author AS source_author
				FROM (
					SELECT *
					FROM claim
					WHERE embedding <|${knnPool}|> $query_embedding
				)
				${postWhere}
				LIMIT ${knnPool}`,
				{
					query_embedding: queryEmbedding,
					...(domain ? { domain } : {}),
					...(minConfidence > 0 ? { minConfidence } : {})
				}
			);
			console.log('[RETRIEVAL] ✓ Vector search returned:', seedClaims?.length || 0, 'claims');
			seedPoolCount = seedClaims?.length || 0;
		} catch (dbErr) {
			if (isDatabaseUnavailable(dbErr)) {
				console.warn('[RETRIEVAL] Database unavailable during seed retrieval');
				return {
					...EMPTY_RESULT,
					degraded: true,
					degraded_reason: 'database_unavailable'
				};
			}
			throw dbErr;
		}

		if (!seedClaims || seedClaims.length === 0) {
			console.log('[RETRIEVAL] No seed claims found via vector search');
			return EMPTY_RESULT;
		}

		const seedPool = [...seedClaims];

		// Diversity-aware seed selection: prefer source variety before filling by rank.
		// This reduces flat neighborhoods dominated by one source.
		if (seedClaims.length > 1) {
			const diverse: SeedRow[] = [];
			const seenSources = new Set<string>();
			for (const claim of seedClaims) {
				const sourceKey = claim.source_title || 'unknown';
				if (!seenSources.has(sourceKey)) {
					diverse.push(claim);
					seenSources.add(sourceKey);
				}
				if (diverse.length >= topK) break;
			}
			if (diverse.length < topK) {
				for (const claim of seedClaims) {
					if (diverse.includes(claim)) continue;
					diverse.push(claim);
					if (diverse.length >= topK) break;
				}
			}
			seedClaims = diverse.slice(0, topK);
		}

		const vettedSeeds: SeedRow[] = [];
		for (const seed of seedClaims) {
			const sourceOk = await sourceHasPassageCoverage(seed.source_id);
			if (!sourceOk) {
				addRejectedClaim({
					id: typeof seed.id === 'object' ? String(seed.id) : seed.id,
					text: seed.text,
					source_title: seed.source_title ?? 'Unknown',
					confidence: seed.confidence,
					reason_code: 'source_integrity_gate',
					considered_in: 'seed_pool'
				});
				continue;
			}
			vettedSeeds.push(seed);
		}
		seedClaims = vettedSeeds;
		if (seedClaims.length === 0) {
			return {
				...EMPTY_RESULT,
				degraded: true,
				degraded_reason: 'source_integrity_gate'
			};
		}

		console.log(`[RETRIEVAL] Found ${seedClaims.length} seed claims`);
		const seedClaimIds = seedClaims.map((seed) =>
			typeof seed.id === 'object' ? String(seed.id) : seed.id
		);
		const selectedSeedIds = new Set(seedClaimIds);
		for (const candidate of seedPool) {
			const candidateId = typeof candidate.id === 'object' ? String(candidate.id) : candidate.id;
			if (selectedSeedIds.has(candidateId)) continue;
			addRejectedClaim({
				id: candidateId,
				text: candidate.text,
				source_title: candidate.source_title ?? 'Unknown',
				confidence: candidate.confidence,
				reason_code: 'seed_pool_pruned',
				considered_in: 'seed_pool'
			});
		}

		// ── Step 3: Graph traversal for each seed claim ──────────────
		// Collect all claim IDs and argument IDs discovered via traversal

		type TraversalRow = {
			depends_on_incoming_claims: GraphClaim[];
			depends_on_outgoing_claims: GraphClaim[];
			supporting_incoming_claims: GraphClaim[];
			supporting_outgoing_claims: GraphClaim[];
			contradicting_incoming_claims: GraphClaim[];
			contradicting_outgoing_claims: GraphClaim[];
			responds_to_incoming_claims: GraphClaim[];
			responds_to_outgoing_claims: GraphClaim[];
			defining_incoming_claims: GraphClaim[];
			defining_outgoing_claims: GraphClaim[];
			qualifying_incoming_claims: GraphClaim[];
			qualifying_outgoing_claims: GraphClaim[];
			refining_incoming_claims: GraphClaim[];
			refining_outgoing_claims: GraphClaim[];
			exemplifying_incoming_claims: GraphClaim[];
			exemplifying_outgoing_claims: GraphClaim[];
			arguments: GraphArgRef[];
		};

		type GraphClaim = {
			id: string;
			text: string;
			claim_type: string;
			domain: PhilosophicalDomain;
			confidence: number;
			position_in_source: number;
			review_state?: string;
			source: { id?: string; title: string; author: string[] } | string;
		};

		type GraphArgRef = {
			id: string;
		};

		const allGraphClaims: Map<string, RetrievedClaim> = new Map();
		const argumentIds: Set<string> = new Set();

		// Add seed claims to the map first
		for (const seed of seedClaims) {
			const id = typeof seed.id === 'object' ? String(seed.id) : seed.id;
			allGraphClaims.set(id, {
				id,
				text: seed.text,
				claim_type: seed.claim_type,
				domain: seed.domain,
				source_title: seed.source_title ?? 'Unknown',
				source_author: seed.source_author ?? [],
				confidence: seed.confidence,
				position_in_source: seed.position_in_source ?? 0
			});
		}

		const resolveSource = (claim: GraphClaim): { id?: string; title: string; author: string[] } => {
			if (claim.source && typeof claim.source === 'object' && 'title' in claim.source) {
				return {
					id: (claim.source as { id?: string }).id,
					title: (claim.source as { title: string }).title,
					author: (claim.source as { author: string[] }).author ?? []
				};
			}
			return { title: 'Unknown', author: [] };
		};

		const registerCandidate = (
			claim: GraphClaim | undefined,
			anchorId: string,
			hopCandidates: Map<string, { claim: GraphClaim; anchorId: string }>
		): void => {
			if (!claim) return;
			const claimId = typeof claim.id === 'object' ? String(claim.id) : claim.id;
			const source = resolveSource(claim);
			if (claim.review_state === 'rejected' || claim.review_state === 'merged') return;
			if (trustedGraphActive && claim.review_state !== 'accepted') return;
			if (allGraphClaims.has(claimId)) {
				addRejectedClaim({
					id: claimId,
					text: claim.text,
					source_title: source.title,
					confidence: claim.confidence,
					reason_code: 'duplicate_traversal',
					considered_in: 'traversal',
					anchor_claim_id: anchorId
				});
				return;
			}
			const existing = hopCandidates.get(claimId);
			if (!existing || (claim.confidence ?? 0) > (existing.claim.confidence ?? 0)) {
				hopCandidates.set(claimId, { claim, anchorId });
			}
		};

		const maxNewClaimsPerHop = topK >= 10 ? 48 : topK <= 3 ? 12 : 28;
		let frontier = new Set(seedClaimIds);
		const traversedAnchors = new Set<string>();

		for (let hop = 1; hop <= traversalMaxHops; hop++) {
			if (frontier.size === 0 || allGraphClaims.size >= traversalClaimCap) break;

			const hopCandidates = new Map<string, { claim: GraphClaim; anchorId: string }>();

			for (const anchorId of frontier) {
				if (traversedAnchors.has(anchorId)) continue;
				traversedAnchors.add(anchorId);

				try {
					const traversal = await query<TraversalRow[]>(
						`SELECT
							<-depends_on<-claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS depends_on_incoming_claims,
							->depends_on->claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS depends_on_outgoing_claims,
							<-supports<-claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS supporting_incoming_claims,
							->supports->claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS supporting_outgoing_claims,
							<-contradicts<-claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS contradicting_incoming_claims,
							->contradicts->claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS contradicting_outgoing_claims,
							<-responds_to<-claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS responds_to_incoming_claims,
							->responds_to->claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS responds_to_outgoing_claims,
							<-defines<-claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS defining_incoming_claims,
							->defines->claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS defining_outgoing_claims,
							<-qualifies<-claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS qualifying_incoming_claims,
							->qualifies->claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS qualifying_outgoing_claims,
							<-refines<-claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS refining_incoming_claims,
							->refines->claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS refining_outgoing_claims,
							<-exemplifies<-claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS exemplifying_incoming_claims,
							->exemplifies->claim.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS exemplifying_outgoing_claims,
							->part_of->argument.{id} AS arguments
						FROM $seed_id`,
						{ seed_id: anchorId }
					);
					if (!traversal || traversal.length === 0) continue;
					const row = Array.isArray(traversal) ? traversal[0] : traversal;

					const addGraphClaims = (claims: GraphClaim[] | undefined) => {
						if (!claims || !Array.isArray(claims)) return;
						for (const c of claims) registerCandidate(c, anchorId, hopCandidates);
					};

					for (const spec of RELATION_TRAVERSAL_SPECS) {
						addGraphClaims(row[spec.incoming]);
						addGraphClaims(row[spec.outgoing]);
					}

					if (row.arguments && Array.isArray(row.arguments)) {
						for (const a of row.arguments) {
							const aId = typeof a.id === 'object' ? String(a.id) : a.id;
							argumentIds.add(aId);
						}
					}
				} catch (traversalErr) {
					console.warn(
						`[RETRIEVAL] Graph traversal failed for ${anchorId}:`,
						traversalErr instanceof Error ? traversalErr.message : traversalErr
					);
				}
			}

			const candidates = Array.from(hopCandidates.values()).sort(
				(a, b) => (b.claim.confidence ?? 0) - (a.claim.confidence ?? 0)
			);
			const selected: Array<{ claim: GraphClaim; anchorId: string }> = [];
			const seenSources = new Set<string>();
			const hopBudget = Math.min(
				maxNewClaimsPerHop,
				Math.max(traversalClaimCap - allGraphClaims.size, 0)
			);

			for (const candidate of candidates) {
				if (selected.length >= hopBudget) break;
				const source = resolveSource(candidate.claim);
				if (!(await sourceHasPassageCoverage(source.id))) {
					addRejectedClaim({
						id:
							typeof candidate.claim.id === 'object'
								? String(candidate.claim.id)
								: candidate.claim.id,
						text: candidate.claim.text,
						source_title: source.title,
						confidence: candidate.claim.confidence,
						reason_code: 'source_integrity_gate',
						considered_in: 'traversal',
						anchor_claim_id: candidate.anchorId
					});
					continue;
				}
				const sourceTitle = source.title;
				if (seenSources.has(sourceTitle)) continue;
				seenSources.add(sourceTitle);
				selected.push(candidate);
			}
			for (const candidate of candidates) {
				if (selected.length >= hopBudget) break;
				if (selected.includes(candidate)) continue;
				const source = resolveSource(candidate.claim);
				if (!(await sourceHasPassageCoverage(source.id))) {
					addRejectedClaim({
						id:
							typeof candidate.claim.id === 'object'
								? String(candidate.claim.id)
								: candidate.claim.id,
						text: candidate.claim.text,
						source_title: source.title,
						confidence: candidate.claim.confidence,
						reason_code: 'source_integrity_gate',
						considered_in: 'traversal',
						anchor_claim_id: candidate.anchorId
					});
					continue;
				}
				selected.push(candidate);
			}

			const nextFrontier = new Set<string>();
			for (const { claim } of selected) {
				const cId = typeof claim.id === 'object' ? String(claim.id) : claim.id;
				const source = resolveSource(claim);
				allGraphClaims.set(cId, {
					id: cId,
					text: claim.text,
					claim_type: claim.claim_type,
					domain: claim.domain,
					source_title: source.title,
					source_author: source.author,
					confidence: claim.confidence ?? 0.5,
					position_in_source: claim.position_in_source ?? 0
				});
				nextFrontier.add(cId);
			}
			console.log(
				`[RETRIEVAL] hop ${hop}/${traversalMaxHops}: added ${selected.length} claims (frontier ${nextFrontier.size})`
			);
			frontier = nextFrontier;
		}

		// Add argument-neighborhood claims so traversal can surface complete
		// argument structures (conclusions + key premises), not only local edges.
		if (argumentIds.size > 0 && allGraphClaims.size < traversalClaimCap) {
			type ArgumentMemberRow = {
				in: {
					id: string;
					text: string;
					claim_type: string;
					domain: PhilosophicalDomain;
					confidence: number;
					position_in_source: number;
					review_state?: string;
					source: { id?: string; title: string; author: string[] } | string;
				};
				role: string;
			};

			try {
				const memberRows = await query<ArgumentMemberRow[]>(
					`SELECT
						in.{id, text, claim_type, domain, confidence, position_in_source, review_state, source.{id, title, author}} AS in,
						role
					FROM part_of
					WHERE out INSIDE $arg_ids AND ${argumentClaimReviewFilter}`,
					{ arg_ids: Array.from(argumentIds) }
				);

				if (memberRows && Array.isArray(memberRows)) {
					const roleRank = (role: string): number => {
						if (role === 'conclusion') return 0;
						if (role === 'key_premise') return 1;
						if (role === 'supporting_premise') return 2;
						return 3;
					};
					const sorted = [...memberRows].sort((a, b) => {
						const rankDelta = roleRank(a.role) - roleRank(b.role);
						if (rankDelta !== 0) return rankDelta;
						return (b.in?.confidence ?? 0) - (a.in?.confidence ?? 0);
					});

					for (const row of sorted) {
						if (allGraphClaims.size >= traversalClaimCap) break;
						if (!row.in) continue;
						const claim = row.in;
						if (claim.review_state === 'rejected' || claim.review_state === 'merged') continue;
						if (trustedGraphActive && claim.review_state !== 'accepted') continue;
						const cId = typeof claim.id === 'object' ? String(claim.id) : claim.id;
						if (allGraphClaims.has(cId)) continue;
						const source =
							claim.source && typeof claim.source === 'object' && 'title' in claim.source
								? {
										id: (claim.source as { id?: string }).id,
										title: (claim.source as { title: string }).title,
										author: (claim.source as { author: string[] }).author ?? []
									}
								: { title: 'Unknown', author: [] };
						if (!(await sourceHasPassageCoverage(source.id))) {
							addRejectedClaim({
								id: cId,
								text: claim.text,
								source_title: source.title,
								confidence: claim.confidence,
								reason_code: 'source_integrity_gate',
								considered_in: 'traversal'
							});
							continue;
						}

						allGraphClaims.set(cId, {
							id: cId,
							text: claim.text,
							claim_type: claim.claim_type,
							domain: claim.domain,
							source_title: source.title,
							source_author: source.author,
							confidence: claim.confidence ?? 0.5,
							position_in_source: claim.position_in_source ?? 0
						});
					}
				}
			} catch (argNeighborhoodErr) {
				console.warn(
					'[RETRIEVAL] Failed to expand argument-neighborhood claims:',
					argNeighborhoodErr instanceof Error ? argNeighborhoodErr.message : argNeighborhoodErr
				);
			}
		}

		// ── Step 4: Build deduplicated claims array ──────────────────
		const claims = Array.from(allGraphClaims.values());
		const claimIdToIndex = new Map<string, number>();
		claims.forEach((c, i) => claimIdToIndex.set(c.id, i));

		console.log(`[RETRIEVAL] ${claims.length} unique claims after graph traversal`);

		// ── Step 5: Resolve relations between claims in result set ───
		const relations: RetrievedRelation[] = [];
		const claimIds = claims.map((c) => c.id);
		let relationCandidateCount = 0;
		const keptRelationKeys = new Set<string>();

		if (claimIds.length >= 2) {
			type RelRow = {
				in: string;
				out: string;
				relation_type: string;
				strength?: string;
				note?: string;
			};

			for (const { table, relationType } of RELATION_FETCH_SPECS) {
				try {
					const rels = await query<RelRow[]>(
						`SELECT in, out, $table AS relation_type, strength, note
						FROM ${table}
						WHERE in INSIDE $ids AND out INSIDE $ids AND ${relationReviewFilter}`,
						{ ids: claimIds, table }
					);

						if (rels && Array.isArray(rels)) {
							relationCandidateCount += rels.length;
							for (const rel of rels) {
								const fromId = typeof rel.in === 'object' ? String(rel.in) : rel.in;
								const toId = typeof rel.out === 'object' ? String(rel.out) : rel.out;
								const fromIdx = claimIdToIndex.get(fromId);
								const toIdx = claimIdToIndex.get(toId);

								if (fromIdx === undefined || toIdx === undefined) {
									rejectedRelations.push({
										from_claim_id: fromId,
										to_claim_id: toId,
										relation_type: relationType,
										reason_code: 'missing_endpoint',
										strength: rel.strength,
										note: rel.note
									});
									continue;
								}

								const relationKey = `${fromIdx}|${toIdx}|${relationType}`;
								if (keptRelationKeys.has(relationKey)) {
									rejectedRelations.push({
										from_claim_id: fromId,
										to_claim_id: toId,
										relation_type: relationType,
										reason_code: 'duplicate_relation',
										strength: rel.strength,
										note: rel.note
									});
									continue;
								}

								keptRelationKeys.add(relationKey);
								relations.push({
									from_index: fromIdx,
									to_index: toIdx,
									relation_type: relationType,
									strength: rel.strength,
									note: rel.note
								});
							}
						}
					} catch (relErr) {
					console.warn(
						`[RETRIEVAL] Failed to query ${table} relations:`,
						relErr instanceof Error ? relErr.message : relErr
					);
				}
			}
		}

		console.log(`[RETRIEVAL] ${relations.length} relations among retrieved claims`);

		// ── Step 6: Fetch argument structures ────────────────────────
		const arguments_: RetrievedArgument[] = [];

		for (const argId of argumentIds) {
			try {
				type ArgRow = {
					id: string;
					name: string;
					tradition: string | null;
					domain: PhilosophicalDomain;
					summary: string;
					member_claims: Array<{
						text: string;
						role: string;
					}>;
				};

				const argRows = await query<ArgRow[]>(
					`SELECT
						*,
						<-part_of<-claim.{text, role: <-part_of[WHERE out = $arg_id].role} AS member_claims
					FROM $arg_id`,
					{ arg_id: argId }
				);

				if (!argRows || argRows.length === 0) continue;

				const arg = Array.isArray(argRows) ? argRows[0] : argRows;

				// Try a simpler approach to get member claims with roles
				let conclusionText: string | null = null;
				const keyPremises: string[] = [];

				// Fetch part_of relations pointing to this argument
				type PartOfRow = {
					in: string;
					role: string;
					claim_text?: string;
				};

				const partOfRels = await query<PartOfRow[]>(
					`SELECT in, role, in.text AS claim_text
					FROM part_of
					WHERE out = $arg_id`,
					{ arg_id: argId }
				);

				if (partOfRels && Array.isArray(partOfRels)) {
					for (const po of partOfRels) {
						if (po.role === 'conclusion' && po.claim_text) {
							conclusionText = po.claim_text;
						} else if (po.role === 'key_premise' && po.claim_text) {
							keyPremises.push(po.claim_text);
						}
					}
				}

				arguments_.push({
					id: typeof arg.id === 'object' ? String(arg.id) : arg.id,
					name: arg.name,
					tradition: arg.tradition,
					domain: arg.domain as PhilosophicalDomain,
					summary: arg.summary,
					conclusion_text: conclusionText,
					key_premises: keyPremises
				});
			} catch (argErr) {
				console.warn(
					`[RETRIEVAL] Failed to fetch argument ${argId}:`,
					argErr instanceof Error ? argErr.message : argErr
				);
			}
		}

		console.log(`[RETRIEVAL] ${arguments_.length} arguments assembled`);

		return {
			claims,
			relations,
			arguments: arguments_,
			seed_claim_ids: seedClaimIds,
			trace: {
				seed_pool_count: seedPoolCount,
				selected_seed_count: seedClaimIds.length,
				traversed_claim_count: Math.max(claims.length - seedClaimIds.length, 0),
				relation_candidate_count: relationCandidateCount,
				relation_kept_count: relations.length,
				argument_candidate_count: argumentIds.size,
				argument_kept_count: arguments_.length,
				rejected_claims: Array.from(rejectedClaimsByKey.values()).slice(0, 60),
				rejected_relations: rejectedRelations.slice(0, 80)
			},
			degraded: false
		};
	} catch (err) {
		// Top-level catch: SurrealDB unreachable, unexpected errors, etc.
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

/**
 * Format a RetrievalResult into a structured text block for the LLM prompt.
 *
 * Returns a human-readable representation of the retrieved argument graph
 * that the model can use as grounding context for its three-pass analysis.
 */
export function buildContextBlock(result: RetrievalResult): string {
	if (!result.claims || result.claims.length === 0) {
		return 'No knowledge base context available for this query.';
	}

	const lines: string[] = [];

	lines.push('=== PHILOSOPHICAL KNOWLEDGE GRAPH CONTEXT ===');
	lines.push('');
	lines.push(
		'The following are structured claims from SOPHIA\'s curated philosophical knowledge graph. ' +
		'Use these as your philosophical foundation, noting their typed logical relations and source attributions.'
	);
	lines.push('');

	// ── Claims with IDs and Relations ──
	for (let i = 0; i < result.claims.length; i++) {
		const c = result.claims[i];
		const claimId = `c:${String(i + 1).padStart(3, '0')}`;
		const authorStr = c.source_author?.length
			? c.source_author.join(', ')
			: 'Unknown';
		lines.push(`CLAIM [${claimId}] (${c.claim_type}, source: "${c.source_title}")`);
		lines.push(`"${c.text}"`);
		
		// Show relations from this claim
		const outgoingRelations = result.relations.filter(r => r.from_index === i);
		if (outgoingRelations.length > 0) {
			for (const r of outgoingRelations) {
				const targetId = `c:${String(r.to_index + 1).padStart(3, '0')}`;
				const relType = r.relation_type.toUpperCase().replace(/_/g, ' ');
				const strengthStr = r.strength ? ` (${r.strength})` : '';
				lines.push(`  ├─ ${relType} [${targetId}]${strengthStr}`);
			}
		}
		lines.push('');
	}

	// ── Arguments ──
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

	lines.push('=== END KNOWLEDGE GRAPH CONTEXT ===');
	lines.push('');
	lines.push('Use Google Search to verify, challenge, or extend these claims with current sources.');

	return lines.join('\n');
}
