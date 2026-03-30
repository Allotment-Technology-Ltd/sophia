import { describe, expect, it } from 'vitest';
import {
	canonicalizeThinkerName,
	estimateThinkerNameConfidence,
	pickThinkerAutoLinkCandidate
} from './thinkerIdentity';

describe('thinkerIdentity', () => {
	it('canonicalizes punctuation and diacritics', () => {
		expect(canonicalizeThinkerName('Prof. Émile Durkheim')).toBe('emile durkheim');
	});

	it('scores exact and initial matches strongly', () => {
		const exact = estimateThinkerNameConfidence('Immanuel Kant', 'Immanuel Kant');
		const initial = estimateThinkerNameConfidence('I. Kant', 'Immanuel Kant');
		expect(exact).toBeGreaterThanOrEqual(0.99);
		expect(initial).toBeGreaterThanOrEqual(0.89);
	});

	it('rejects ambiguous candidates when delta is small', () => {
		const decision = pickThinkerAutoLinkCandidate(
			[
				{ wikidata_id: 'Q1', name: 'Thomas Nagel', confidence: 0.92 },
				{ wikidata_id: 'Q2', name: 'Ernest Nagel', confidence: 0.88 }
			],
			0.86,
			0.08
		);
		expect(decision.best).toBeNull();
		expect(decision.reason).toBe('ambiguous');
	});

	it('selects high-confidence unambiguous candidate', () => {
		const decision = pickThinkerAutoLinkCandidate(
			[
				{ wikidata_id: 'Q1', name: 'Immanuel Kant', confidence: 1 },
				{ wikidata_id: 'Q2', name: 'David Hume', confidence: 0.63 }
			],
			0.86,
			0.08
		);
		expect(decision.best?.wikidata_id).toBe('Q1');
		expect(decision.reason).toBe('ok');
	});
});
