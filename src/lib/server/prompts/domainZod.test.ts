import { describe, expect, it, afterEach } from 'vitest';
import { claimDomainForSurrealStorage } from './domainZod';

describe('claimDomainForSurrealStorage', () => {
	const prev = process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT;

	afterEach(() => {
		if (prev === undefined) delete process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT;
		else process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT = prev;
	});

	it('returns coerced taxonomy when legacy compat is off', () => {
		delete process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT;
		expect(claimDomainForSurrealStorage('history_of_philosophy')).toBe('history_of_philosophy');
	});

	it('maps history_of_philosophy into legacy assert set when compat is on', () => {
		process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT = '1';
		expect(claimDomainForSurrealStorage('history_of_philosophy')).toBe('political_philosophy');
	});

	it('passes through values already in the legacy set', () => {
		process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT = '1';
		expect(claimDomainForSurrealStorage('ethics')).toBe('ethics');
	});
});
