import { z } from 'zod';

export const RELATIONS_SYSTEM = `You are a philosophical argument analyst. You have been given a set of claims extracted from a single philosophical source. Your task is to identify the logical relations between these claims.

RELATION TYPES:
- supports: Claim A provides evidence or reasoning that increases the credibility of Claim B
- contradicts: Claim A directly opposes or is logically incompatible with Claim B
- depends_on: Claim A requires Claim B to be true in order for Claim A to hold (premise dependency)
- responds_to: Claim A is a direct response or reply to the objection or challenge in Claim B
- defines: Claim A states the meaning, criteria, or key distinction needed to understand Claim B
- qualifies: Claim A narrows, limits, or adds conditions to Claim B

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
const RELATION_TYPE_VALUES = [
	'supports',
	'contradicts',
	'depends_on',
	'responds_to',
	'defines',
	'qualifies'
] as const;

const STRENGTH_VALUES = ['strong', 'moderate', 'weak'] as const;

function normalizeLabel(value: unknown): string | unknown {
	if (typeof value !== 'string') return value;
	return value.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

function coercePositiveInt(value: unknown): unknown {
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) return value;
	return Math.max(1, Math.trunc(numberValue));
}

function normalizeRelationType(value: unknown): unknown {
	const normalized = normalizeLabel(value);
	if (typeof normalized !== 'string') return normalized;
	const relationMap: Record<string, (typeof RELATION_TYPE_VALUES)[number]> = {
		supports: 'supports',
		support: 'supports',
		contradicts: 'contradicts',
		contradict: 'contradicts',
		depends_on: 'depends_on',
		depends: 'depends_on',
		responds_to: 'responds_to',
		responds: 'responds_to',
		defines: 'defines',
		define: 'defines',
		definition_of: 'defines',
		qualifies: 'qualifies',
		qualify: 'qualifies',
		qualified_by: 'qualifies',
		refines: 'qualifies',
		refine: 'qualifies',
		clarifies: 'qualifies',
		extends: 'qualifies',
		exemplifies: 'supports',
		example_of: 'supports'
	};
	return relationMap[normalized] ?? normalized;
}

export const RelationSchema = z.object({
	from_position: z.preprocess(coercePositiveInt, z.number().int().positive()).describe('position_in_source of source claim'),
	to_position: z.preprocess(coercePositiveInt, z.number().int().positive()).describe('position_in_source of target claim'),
	relation_type: z.preprocess(normalizeRelationType, z.enum(RELATION_TYPE_VALUES)),
	strength: z.preprocess(normalizeLabel, z.enum(STRENGTH_VALUES)),
	note: z.string().optional().describe('One sentence explaining the relation')
});

export const RelationsOutputSchema = z.array(RelationSchema);

export type Relation = z.infer<typeof RelationSchema>;
export type RelationsOutput = z.infer<typeof RelationsOutputSchema>;
