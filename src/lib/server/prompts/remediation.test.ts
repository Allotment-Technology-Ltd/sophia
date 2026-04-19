import { describe, expect, it } from 'vitest';
import {
	normalizeRemediationRepairOutput,
	REMEDIATION_REPAIR_USER,
	RemediationRepairOutputSchema
} from './remediation.js';

describe('remediation repair', () => {
	it('parses valid output', () => {
		const raw = { position_in_source: 3, revised_claim_text: '  Socrates held that virtue is knowledge.  ' };
		const n = normalizeRemediationRepairOutput(raw, 3);
		expect(n.revised_claim_text).toBe('Socrates held that virtue is knowledge.');
	});

	it('rejects position mismatch', () => {
		const raw = { position_in_source: 2, revised_claim_text: 'x' };
		expect(() => normalizeRemediationRepairOutput(raw, 3)).toThrow(/position_in_source/);
	});

	it('fills missing revised_claim_text from fallback when provided', () => {
		const raw = { position_in_source: 3, notes: 'model omitted text' };
		const n = normalizeRemediationRepairOutput(raw, 3, {
			fallbackClaimText: 'Original claim text.'
		});
		expect(n.revised_claim_text).toBe('Original claim text.');
	});

	it('REMEDIATION_REPAIR_USER embeds position without backticks in template', () => {
		const u = REMEDIATION_REPAIR_USER({
			position_in_source: 7,
			passage_excerpt: 'hello',
			claim_json: '{}',
			validation_issues: ['low faithfulness']
		});
		expect(u).toContain('position_in_source');
		expect(u).toContain('7');
		expect(u).toContain('Respond with JSON only');
	});

	it('schema accepts optional notes', () => {
		const p = RemediationRepairOutputSchema.parse({
			position_in_source: 1,
			revised_claim_text: 'a',
			notes: 'ok'
		});
		expect(p.notes).toBe('ok');
	});
});
