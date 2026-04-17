import { describe, it, expect } from 'vitest';
import {
	analyzeGroupingReferenceHealth,
	describePreGroupingGraphLint,
	filterGroupingOutputToKnownClaimPositions,
	normalizeGroupingPayload,
	unwrapGroupingModelPayload
} from './grouping-helpers.js';
import type { GroupingOutput } from '$lib/server/prompts/grouping.js';
import type { PhaseOneClaim, PhaseOneRelation } from './types.js';

describe('unwrapGroupingModelPayload', () => {
	it('unwraps named_arguments wrapper', () => {
		const inner = [{ name: 'A', domain: 'ethics', summary: 's', claims: [] }];
		expect(unwrapGroupingModelPayload({ named_arguments: inner })).toEqual(inner);
	});

	it('passes through bare arrays', () => {
		const arr = [{ name: 'B', domain: 'logic', summary: 's', claims: [] }];
		expect(unwrapGroupingModelPayload(arr)).toBe(arr);
	});
});

describe('normalizeGroupingPayload', () => {
	it('drops claim refs with missing position instead of coercing to 1', () => {
		const out = normalizeGroupingPayload([
			{
				name: 'Test',
				domain: 'ethics',
				summary: 's',
				claims: [{ role: 'conclusion' }, { position_in_source: 7, role: 'key_premise' }]
			}
		]) as { claims: { position_in_source: number }[] }[];
		expect(out[0]!.claims).toEqual([{ position_in_source: 7, role: 'key_premise' }]);
	});

	it('drops refs with invalid numeric position', () => {
		const out = normalizeGroupingPayload([
			{
				name: 'T',
				domain: 'logic',
				summary: 's',
				claims: [
					{ position_in_source: 0, role: 'conclusion' },
					{ position_in_source: 3, role: 'conclusion' }
				]
			}
		]) as { claims: { position_in_source: number }[] }[];
		expect(out[0]!.claims.map((c) => c.position_in_source)).toEqual([3]);
	});
});

describe('filterGroupingOutputToKnownClaimPositions', () => {
	it('drops claim refs whose positions are not in the allowed set', () => {
		const input: GroupingOutput = [
			{
				name: 'A',
				domain: 'ethics',
				summary: 's',
				claims: [
					{ position_in_source: 1, role: 'conclusion' },
					{ position_in_source: 99, role: 'key_premise' }
				]
			}
		];
		const out = filterGroupingOutputToKnownClaimPositions(input, new Set([1, 2]));
		expect(out).toHaveLength(1);
		expect(out[0]!.claims).toEqual([{ position_in_source: 1, role: 'conclusion' }]);
	});

	it('removes arguments that have no claims left after filtering', () => {
		const input: GroupingOutput = [
			{
				name: 'EmptyAfter',
				domain: 'logic',
				summary: 's',
				claims: [{ position_in_source: 50, role: 'conclusion' }]
			},
			{
				name: 'Keeps',
				domain: 'logic',
				summary: 's',
				claims: [{ position_in_source: 2, role: 'conclusion' }]
			}
		];
		const out = filterGroupingOutputToKnownClaimPositions(input, new Set([2]));
		expect(out).toHaveLength(1);
		expect(out[0]!.name).toBe('Keeps');
	});
});

describe('describePreGroupingGraphLint', () => {
	const claim = (pos: number): PhaseOneClaim =>
		({ position_in_source: pos } as PhaseOneClaim);

	it('warns when there are many claims but no relations', () => {
		const claims = Array.from({ length: 10 }, (_, i) => claim(i + 1));
		const w = describePreGroupingGraphLint(claims, []);
		expect(w.length).toBeGreaterThan(0);
		expect(w[0]).toContain('no Stage-2 relations');
	});

	it('warns when most claims are relation-isolated', () => {
		const claims = Array.from({ length: 12 }, (_, i) => claim(i + 1));
		const relations: PhaseOneRelation[] = [
			{
				from_position: 1,
				to_position: 2
			} as PhaseOneRelation
		];
		const w = describePreGroupingGraphLint(claims, relations);
		expect(w.some((x) => x.includes('fragmented'))).toBe(true);
	});

	it('returns no warnings for small graphs', () => {
		expect(describePreGroupingGraphLint([claim(1), claim(2)], [])).toEqual([]);
	});
});

describe('analyzeGroupingReferenceHealth', () => {
	it('does not mark collapsed when total references are below threshold', () => {
		const args: GroupingOutput = [
			{
				name: 'X',
				domain: 'ethics',
				summary: 's',
				claims: Array.from({ length: 19 }, (_, i) => ({
					position_in_source: i + 1,
					role: 'key_premise' as const
				}))
			}
		];
		const h = analyzeGroupingReferenceHealth(args);
		expect(h.totalReferences).toBe(19);
		expect(h.collapsed).toBe(false);
	});

	it('marks collapsed when many refs collapse to few unique positions', () => {
		const claims = Array.from({ length: 25 }, () => ({
			position_in_source: 1,
			role: 'conclusion' as const
		}));
		const h = analyzeGroupingReferenceHealth([
			{ name: 'Degenerate', domain: 'ethics', summary: 's', claims }
		]);
		expect(h.totalReferences).toBe(25);
		expect(h.uniquePositions).toBe(1);
		expect(h.collapsed).toBe(true);
	});

	it('marks collapsed when unique positions are few even with spread refs', () => {
		const claims = Array.from({ length: 25 }, (_, i) => ({
			position_in_source: (i % 3) + 1,
			role: 'key_premise' as const
		}));
		const h = analyzeGroupingReferenceHealth([
			{ name: 'Sparse', domain: 'logic', summary: 's', claims }
		]);
		expect(h.totalReferences).toBe(25);
		expect(h.uniquePositions).toBe(3);
		expect(h.collapsed).toBe(true);
	});
});
