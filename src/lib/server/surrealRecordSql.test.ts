import { describe, expect, it } from 'vitest';
import {
	normalizeBareWikidataQidToThinkerRecordId,
	recordKeyForTable,
	splitRecordTableAndKey,
	toSurrealRecordIdStr
} from './surrealRecordSql.js';

describe('surrealRecordSql', () => {
	it('toSurrealRecordIdStr normalizes SDK-shaped ids', () => {
		expect(toSurrealRecordIdStr({ tb: 'source', id: 'abc123' })).toBe('source:abc123');
		expect(toSurrealRecordIdStr('claim:x_y')).toBe('claim:x_y');
	});

	it('splitRecordTableAndKey handles underscores in key', () => {
		expect(splitRecordTableAndKey('subject:philosophy_of_science')).toEqual({
			tb: 'subject',
			key: 'philosophy_of_science'
		});
	});

	it('recordKeyForTable extracts source row key', () => {
		expect(recordKeyForTable('source:nght9zeixf5l2e3p7kkz', 'source')).toBe('nght9zeixf5l2e3p7kkz');
	});

	it('normalizeBareWikidataQidToThinkerRecordId prefixes bare Q-ids', () => {
		expect(normalizeBareWikidataQidToThinkerRecordId('Q1345191')).toBe('thinker:Q1345191');
		expect(normalizeBareWikidataQidToThinkerRecordId('thinker:Q9061')).toBe('thinker:Q9061');
		expect(normalizeBareWikidataQidToThinkerRecordId('')).toBe('');
	});
});
