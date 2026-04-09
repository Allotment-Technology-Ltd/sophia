/**
 * SOPHIA adapter: map full {@link RetrievalResult} onto the portable input type consumed by
 * `buildPassSpecificContextPacks` from `@restormel/context-packs`.
 *
 * @see https://www.npmjs.com/package/@restormel/context-packs
 * @see https://restormel.dev/graph/docs — published graph + reasoning packages; context-packs is separate (retrieval → LLM blocks).
 */

import type { ContextPackArgument, ContextPackRetrievalInput } from '@restormel/context-packs';
import type { RetrievalResult } from './retrieval';

export type {
	ContextPackArgument,
	ContextPackClaim,
	ContextPackRelation,
	ContextPackRetrievalInput
} from '@restormel/context-packs';


/**
 * {@link RetrievalResult} fields that context pack construction does **not** read.
 * Safe to omit on alternate backends when only `buildPassSpecificContextPacks` is used.
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

function argumentToContextPackShape(arg: RetrievalResult['arguments'][number]): ContextPackArgument {
	return {
		name: arg.name,
		tradition: arg.tradition,
		summary: arg.summary,
		key_premises: arg.key_premises,
		conclusion_text: arg.conclusion_text ?? undefined
	};
}

/** Narrows a full SOPHIA retrieval result to the portable input type (shallow copy for arguments). */
export function contextPackInputFromRetrieval(result: RetrievalResult): ContextPackRetrievalInput {
	return {
		claims: result.claims,
		relations: result.relations,
		arguments: result.arguments.map(argumentToContextPackShape),
		seed_claim_ids: result.seed_claim_ids
	};
}
