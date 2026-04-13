import { describe, expect, it } from 'vitest';
import {
	ingestRunSourceIdentityKey,
	pickSupersededFailedIngestRunIds
} from './pruneSupersededFailedIngestRuns';

describe('ingestRunSourceIdentityKey', () => {
	it('uses canonical URL hash for http URLs', () => {
		const a = ingestRunSourceIdentityKey('https://plato.stanford.edu/entries/kant/');
		const b = ingestRunSourceIdentityKey('https://plato.stanford.edu/entries/kant');
		expect(a).toBe(b);
		expect(a.startsWith('h:')).toBe(true);
	});
});

describe('pickSupersededFailedIngestRunIds', () => {
	const d = (iso: string) => new Date(iso);

	it('returns nothing when no successful run exists for the source', () => {
		const ids = pickSupersededFailedIngestRunIds(
			[{ id: 'e1', sourceUrl: 'https://example.com/a', completedAt: d('2026-01-01T00:00:00Z') }],
			[]
		);
		expect(ids).toEqual([]);
	});

	it('deletes only errors older than latest done for the same canonical source', () => {
		const url = 'https://plato.stanford.edu/entries/kant';
		const ids = pickSupersededFailedIngestRunIds(
			[
				{ id: 'fail_old', sourceUrl: url, completedAt: d('2026-01-01T00:00:00Z') },
				{ id: 'fail_new', sourceUrl: url, completedAt: d('2026-06-01T00:00:00Z') }
			],
			[{ id: 'ok1', sourceUrl: `${url}/`, completedAt: d('2026-03-01T00:00:00Z') }]
		);
		expect(ids.sort()).toEqual(['fail_old']);
	});

	it('does not delete an error that is newer than the only done run', () => {
		const url = 'https://plato.stanford.edu/entries/hegel';
		const ids = pickSupersededFailedIngestRunIds(
			[{ id: 'fail_after', sourceUrl: url, completedAt: d('2026-06-01T00:00:00Z') }],
			[{ id: 'ok1', sourceUrl: url, completedAt: d('2026-01-01T00:00:00Z') }]
		);
		expect(ids).toEqual([]);
	});
});
