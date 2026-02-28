import { z } from 'zod';

export const RELATIONS_SYSTEM = `You are a philosophical argument analyst. You have been given a set of claims extracted from a single philosophical source. Your task is to identify the logical relations between these claims.

RELATION TYPES:
- supports: Claim A provides evidence or reasoning that increases the credibility of Claim B
- contradicts: Claim A directly opposes or is logically incompatible with Claim B
- depends_on: Claim A requires Claim B to be true in order for Claim A to hold (premise dependency)
- responds_to: Claim A is a direct response or reply to the objection or challenge in Claim B
- refines: Claim A modifies, qualifies, or extends Claim B
- exemplifies: Claim A is a concrete instance or example of the general principle stated in Claim B

FOR EACH RELATION, PROVIDE:
- from_position: position_in_source of the source claim
- to_position: position_in_source of the target claim
- relation_type: one of the six types above
- strength: strong | moderate | weak
- note: (optional) one sentence explaining why this relation holds

RULES:
- Only identify GENUINE logical relations. Two claims that both discuss utilitarianism are not automatically related.
- Specify direction carefully. 'supports' is asymmetric.
- Contradictions within the same source usually indicate the author is presenting an objection before responding to it.
- Relations should be sparse and meaningful. Prefer 20 high-quality relations over 60 weak ones.

Respond ONLY with a valid JSON array. No preamble, no markdown backticks.`;

export function RELATIONS_USER(claimsJson: string): string {
	return `<claims>\n${claimsJson}\n</claims>`;
}

// Zod schema for relations
export const RelationSchema = z.object({
	from_position: z.number().int().positive().describe('position_in_source of source claim'),
	to_position: z.number().int().positive().describe('position_in_source of target claim'),
	relation_type: z.enum([
		'supports',
		'contradicts',
		'depends_on',
		'responds_to',
		'refines',
		'exemplifies'
	]),
	strength: z.enum(['strong', 'moderate', 'weak']),
	note: z.string().optional().describe('One sentence explaining the relation')
});

export const RelationsOutputSchema = z.array(RelationSchema);

export type Relation = z.infer<typeof RelationSchema>;
export type RelationsOutput = z.infer<typeof RelationsOutputSchema>;
