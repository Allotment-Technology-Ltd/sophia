import { describe, expect, it, afterEach } from 'vitest';
import { claimDomainForSurrealStorage } from './domainZod';

describe('claimDomainForSurrealStorage', () => {
	const prev = process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT;

	afterEach(() => {
		if (prev === undefined) delete process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT;
		else process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT = prev;
	});

	it('returns coerced taxonomy when wide schema is requested (compat off)', () => {
		process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT = '0';
		expect(claimDomainForSurrealStorage('history_of_philosophy')).toBe('history_of_philosophy');
	});

	it('by default maps extended labels into the legacy assert set', () => {
		delete process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT;
		expect(claimDomainForSurrealStorage('history_of_philosophy')).toBe('political_philosophy');
	});

	it('maps philosophy_general into a legacy bucket (not stored verbatim)', () => {
		delete process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT;
		expect(claimDomainForSurrealStorage('philosophy_general')).toBe('metaphysics');
	});

	it('passes through values already in the legacy set', () => {
		delete process.env.INGEST_SURREAL_DOMAIN_LEGACY_COMPAT;
		expect(claimDomainForSurrealStorage('ethics')).toBe('ethics');
	});
});
