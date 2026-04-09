import { describe, expect, it } from 'vitest';
import type { ContextPackRetrievalInput } from '@restormel/context-packs';
import { buildPassSpecificContextPacks } from './contextPacks';

const fixture: ContextPackRetrievalInput = {
	claims: [
		{
			id: 'c1',
			text: 'Public reason constrains coercive law.',
			claim_type: 'thesis',
			source_title: 'Rawls',
			confidence: 0.9
		},
		{
			id: 'c2',
			text: 'This principle overlooks epistemic injustice objections.',
			claim_type: 'objection',
			source_title: 'Fricker',
			confidence: 0.84
		},
		{
			id: 'c3',
			text: 'A reply is that public reason can incorporate testimonial justice.',
			claim_type: 'response',
			source_title: 'Recent commentary',
			confidence: 0.82
		},
		{
			id: 'c4',
			text: 'Definition: epistemic injustice is wrongful harm in one’s capacity as knower.',
			claim_type: 'definition',
			source_title: 'Fricker',
			confidence: 0.92
		},
		{
			id: 'c5',
			text: 'A competing objection rejects public reason entirely.',
			claim_type: 'objection',
			source_title: 'Critic',
			confidence: 0.78
		}
	],
	relations: [
		{ from_index: 1, to_index: 0, relation_type: 'contradicts' },
		{ from_index: 2, to_index: 1, relation_type: 'responds_to' },
		{ from_index: 4, to_index: 0, relation_type: 'contradicts' }
	],
	arguments: [
		{
			name: 'Public Reason Core Argument',
			tradition: 'Liberalism',
			summary: 'Reasonable citizens should justify coercive laws with shared reasons.',
			conclusion_text: 'Public reason constrains coercive law.',
			key_premises: ['Respect for free and equal citizens']
		}
	],
	seed_claim_ids: ['c1', 'c2']
};

describe('buildPassSpecificContextPacks (@restormel/context-packs)', () => {
	it('builds role-differentiated packs with synthesis tension stats', () => {
		const packs = buildPassSpecificContextPacks(fixture, { depthMode: 'standard' });

		expect(packs.analysis.stats.claim_count).toBeGreaterThan(0);
		expect(packs.critique.stats.role_counts.objection).toBeGreaterThanOrEqual(
			packs.analysis.stats.role_counts.objection
		);
		expect(packs.synthesis.stats.reply_chain_count).toBeGreaterThanOrEqual(1);
		expect(packs.synthesis.stats.unresolved_tension_count).toBeGreaterThanOrEqual(1);
		expect(packs.analysis.block).toContain('CLAIM [c:001]');
		expect(packs.analysis.block).toContain('source:');
	});

	it('enforces token budget by truncating when budget is tiny', () => {
		const packs = buildPassSpecificContextPacks(fixture, { depthMode: 'quick' });
		expect(packs.analysis.stats.estimated_tokens).toBeLessThanOrEqual(
			packs.analysis.stats.token_budget
		);
	});
});
