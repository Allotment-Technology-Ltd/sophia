import { describe, expect, it } from 'vitest';
import { extractWikidataThinkerId } from './thinkerWikidataId';

describe('extractWikidataThinkerId', () => {
	it('returns null for empty', () => {
		expect(extractWikidataThinkerId('')).toBeNull();
		expect(extractWikidataThinkerId('   ')).toBeNull();
	});

	it('normalizes plain Q-id', () => {
		expect(extractWikidataThinkerId('Q9312')).toBe('Q9312');
		expect(extractWikidataThinkerId('q9312')).toBe('Q9312');
	});

	it('extracts from Wikidata URL', () => {
		expect(
			extractWikidataThinkerId('https://www.wikidata.org/wiki/Q9312')
		).toBe('Q9312');
	});

	it('returns null when no Q-id', () => {
		expect(extractWikidataThinkerId('https://example.com/foo')).toBeNull();
	});
});
