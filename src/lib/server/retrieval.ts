/**
 * SOPHIA — Argument-Aware Retrieval
 *
 * Core differentiator: not just semantic similarity, but graph traversal
 * that assembles complete argumentative chains from the knowledge graph.
 *
 * Retrieval pipeline:
 *   1. Embed query via Voyage AI
 *   2. Vector search for top-K semantically similar claims
 *   3. Graph traversal for each seed claim (depends_on, supports, contradicts, responds_to, part_of)
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

export interface RetrievalResult {
	claims: RetrievedClaim[];
	relations: RetrievedRelation[];
	arguments: RetrievedArgument[];
	seed_claim_ids: string[];
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
}

const EMPTY_RESULT: RetrievalResult = {
	claims: [],
	relations: [],
	arguments: [],
	seed_claim_ids: [],
	degraded: false
};

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
	const { topK = 5, domain, minConfidence = 0 } = options;

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
		const postFilters: string[] = [];
		if (domain) postFilters.push('domain = $domain');
		if (minConfidence > 0) postFilters.push('confidence >= $minConfidence');
		const postWhere = postFilters.length > 0 ? `WHERE ${postFilters.join(' AND ')}` : '';

		type SeedRow = {
			id: string;
			text: string;
			claim_type: string;
			domain: PhilosophicalDomain;
			confidence: number;
			position_in_source: number;
			section_context: string | null;
			source_title: string;
			source_author: string[];
		};

		let seedClaims: SeedRow[];
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
					section_context,
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

		console.log(`[RETRIEVAL] Found ${seedClaims.length} seed claims`);
		const seedClaimIds = seedClaims.map((seed) =>
			typeof seed.id === 'object' ? String(seed.id) : seed.id
		);

		// ── Step 3: Graph traversal for each seed claim ──────────────
		// Collect all claim IDs and argument IDs discovered via traversal

		type TraversalRow = {
			depends_on_claims: GraphClaim[];
			supporting_claims: GraphClaim[];
			contradicting_claims: GraphClaim[];
			responds_to_claims: GraphClaim[];
			arguments: GraphArgRef[];
		};

		type GraphClaim = {
			id: string;
			text: string;
			claim_type: string;
			domain: PhilosophicalDomain;
			confidence: number;
			position_in_source: number;
			source: { title: string; author: string[] } | string;
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

		// Traverse graph for each seed
		for (const seed of seedClaims) {
			const seedId = typeof seed.id === 'object' ? String(seed.id) : seed.id;

			try {
				const traversal = await query<TraversalRow[]>(
					`SELECT
						<-depends_on<-claim.{id, text, claim_type, domain, confidence, position_in_source, source.{title, author}} AS depends_on_claims,
						<-supports<-claim.{id, text, claim_type, domain, confidence, position_in_source, source.{title, author}} AS supporting_claims,
						<-contradicts<-claim.{id, text, claim_type, domain, confidence, position_in_source, source.{title, author}} AS contradicting_claims,
						->responds_to->claim.{id, text, claim_type, domain, confidence, position_in_source, source.{title, author}} AS responds_to_claims,
						->part_of->argument.{id} AS arguments
					FROM $seed_id`,
					{ seed_id: seedId }
				);

				if (!traversal || traversal.length === 0) continue;

				const row = Array.isArray(traversal) ? traversal[0] : traversal;

				// Helper to add graph claims to the deduplicated map
				const addGraphClaims = (claims: GraphClaim[] | undefined) => {
					if (!claims || !Array.isArray(claims)) return;
					for (const c of claims) {
						const cId = typeof c.id === 'object' ? String(c.id) : c.id;
						if (allGraphClaims.has(cId)) continue; // already seen

						// Resolve source fields — may be nested object or record link
						let sourceTitle = 'Unknown';
						let sourceAuthor: string[] = [];
						if (c.source && typeof c.source === 'object' && 'title' in c.source) {
							sourceTitle = (c.source as { title: string }).title;
							sourceAuthor = (c.source as { author: string[] }).author ?? [];
						}

						allGraphClaims.set(cId, {
							id: cId,
							text: c.text,
							claim_type: c.claim_type,
							domain: c.domain,
							source_title: sourceTitle,
							source_author: sourceAuthor,
							confidence: c.confidence ?? 0.5,
							position_in_source: c.position_in_source ?? 0
						});
					}
				};

				addGraphClaims(row.depends_on_claims);
				addGraphClaims(row.supporting_claims);
				addGraphClaims(row.contradicting_claims);
				addGraphClaims(row.responds_to_claims);

				// Collect argument IDs
				if (row.arguments && Array.isArray(row.arguments)) {
					for (const a of row.arguments) {
						const aId = typeof a.id === 'object' ? String(a.id) : a.id;
						argumentIds.add(aId);
					}
				}
			} catch (traversalErr) {
				console.warn(
					`[RETRIEVAL] Graph traversal failed for ${seedId}:`,
					traversalErr instanceof Error ? traversalErr.message : traversalErr
				);
				// Continue with other seeds
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

		if (claimIds.length >= 2) {
			type RelRow = {
				in: string;
				out: string;
				relation_type: string;
				strength?: string;
				note?: string;
			};

			const RELATION_TABLES = [
				'supports',
				'contradicts',
				'depends_on',
				'responds_to',
				'refines',
				'exemplifies'
			];

			for (const table of RELATION_TABLES) {
				try {
					const rels = await query<RelRow[]>(
						`SELECT in, out, $table AS relation_type, strength, note
						FROM ${table}
						WHERE in INSIDE $ids AND out INSIDE $ids`,
						{ ids: claimIds, table }
					);

					if (rels && Array.isArray(rels)) {
						for (const rel of rels) {
							const fromId = typeof rel.in === 'object' ? String(rel.in) : rel.in;
							const toId = typeof rel.out === 'object' ? String(rel.out) : rel.out;
							const fromIdx = claimIdToIndex.get(fromId);
							const toIdx = claimIdToIndex.get(toId);

							if (fromIdx !== undefined && toIdx !== undefined) {
								relations.push({
									from_index: fromIdx,
									to_index: toIdx,
									relation_type: table,
									strength: rel.strength,
									note: rel.note
								});
							}
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
