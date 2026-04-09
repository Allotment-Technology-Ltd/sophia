/**
 * Portable seam for Restormel Context extraction: only the retrieval shape that
 * {@link buildPassSpecificContextPacks} consumes. Implementations backed by SurrealDB
 * (SOPHIA's {@link RetrievalResult}) satisfy this structurally; non-Sophia graphs can
 * omit Surreal-only diagnostics on their own DTOs.
 */

import type { RetrievalResult } from './retrieval';

/** Claim fields read by context pack selection and rendering. */
export interface ContextPackClaim {
	id: string;
	text: string;
	claim_type: string;
	source_title: string;
	confidence?: number;
}

/** Relation fields read by context packs (index-local graph). */
export interface ContextPackRelation {
	from_index: number;
	to_index: number;
	relation_type: string;
}

/** Argument fields read by context packs. */
export interface ContextPackArgument {
	name: string;
	tradition: string | null;
	summary: string;
}

/**
 * Minimal retrieval payload for pass-specific context packs (analysis / critique / synthesis).
 * No DB driver, trace, or lineage fields — add those only on your full retrieval type.
 */
export interface ContextPackRetrievalInput {
	claims: ContextPackClaim[];
	relations: ContextPackRelation[];
	arguments: ContextPackArgument[];
	seed_claim_ids: string[];
}

/**
 * {@link RetrievalResult} fields that context pack construction does **not** read.
 * Safe to omit on alternate backends when only {@link buildPassSpecificContextPacks} is used.
 *
 * - **thinker_context** — Wikidata lineage block; appended separately in prompts, not in packs.
 * - **trace** — hybrid/seed/traversal diagnostics (Surreal pipeline).
 * - **degraded** / **degraded_reason** — retrieval quality flags for metadata/UI, not pack text.
 */
export type RetrievalResultFieldsExcludedFromContextPacks =
	| 'thinker_context'
	| 'trace'
	| 'degraded'
	| 'degraded_reason';

/** Narrows a full SOPHIA retrieval result to the portable input type (identity / shallow copy). */
export function contextPackInputFromRetrieval(result: RetrievalResult): ContextPackRetrievalInput {
	return {
		claims: result.claims,
		relations: result.relations,
		arguments: result.arguments,
		seed_claim_ids: result.seed_claim_ids
	};
}
