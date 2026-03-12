import { describe, expect, it } from 'vitest';
import { deriveClaimTypingMetadata } from './claimTyping.js';

describe('deriveClaimTypingMetadata', () => {
	it('infers thinker, tradition, era, scope, and tags from source context', () => {
		const metadata = deriveClaimTypingMetadata(
			{
				text: 'Agents ought to act only on maxims that can be willed as universal law.',
				claim_type: 'thesis',
				domain: 'ethics'
			},
			{
				sourceTitle: 'Groundwork',
				sourceAuthors: ['Immanuel Kant'],
				sourceYear: 1785,
				passageRole: 'thesis'
			}
		);

		expect(metadata.claim_origin).toBe('source_grounded');
		expect(metadata.tradition).toBe('Kantian');
		expect(metadata.thinker).toBe('Kant');
		expect(metadata.era).toBe('early_modern');
		expect(metadata.claim_scope).toBe('normative');
		expect(metadata.subdomain).toBe('normative_ethics');
		expect(metadata.attributed_to).toEqual(['Immanuel Kant']);
	});

	it('preserves explicit model tags and expands concept tags with contested terms', () => {
		const metadata = deriveClaimTypingMetadata(
			{
				text: 'Consciousness cannot be reduced to functional organisation alone.',
				claim_type: 'premise',
				claim_origin: 'interpretive',
				domain: 'philosophy_of_mind',
				subdomain: 'consciousness',
				claim_scope: 'descriptive',
				concept_tags: ['hard problem', 'qualia']
			},
			{
				sourceTitle: 'Facing Up',
				sourceAuthors: ['David Chalmers'],
				sourceYear: 1995,
				passageRole: 'interpretive_commentary'
			}
		);

		expect(metadata.claim_origin).toBe('interpretive');
		expect(metadata.subdomain).toBe('consciousness');
		expect(metadata.claim_scope).toBe('descriptive');
		expect(metadata.concept_tags).toContain('hard problem');
		expect(metadata.contested_terms).toContain('consciousness');
	});
});
