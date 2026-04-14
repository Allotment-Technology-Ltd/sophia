import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DOMAIN_VALUES, preprocessDomainForEnum } from './domainZod.js';

const DomainSchema = z.preprocess(preprocessDomainForEnum, z.enum(DOMAIN_VALUES));

describe('preprocessDomainForEnum', () => {
	it('accepts a single valid label', () => {
		expect(DomainSchema.parse('ethics')).toBe('ethics');
	});

	it('coerces when the model emits the full enum list as an array', () => {
		const list = [...DOMAIN_VALUES];
		const out = DomainSchema.parse(list);
		expect(DOMAIN_VALUES).toContain(out);
	});

	it('uses the first matching label when array has multiple strings', () => {
		expect(DomainSchema.parse(['metaphysics', 'ethics'])).toBe('metaphysics');
	});

	it('falls back when the array has no valid strings', () => {
		expect(DomainSchema.parse([])).toBe('epistemology');
	});
});
