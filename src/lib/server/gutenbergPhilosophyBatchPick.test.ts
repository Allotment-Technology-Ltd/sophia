import { describe, expect, it } from 'vitest';
import { bookMatchesPhilosophyDomain } from './gutenbergPhilosophyBatchPick';

describe('bookMatchesPhilosophyDomain', () => {
	it('accepts general philosophy signal from title', () => {
		const ok = bookMatchesPhilosophyDomain(
			{
				id: 1,
				title: 'Lectures on Moral Philosophy',
				subjects: [],
				bookshelves: [],
				formats: { 'text/plain; charset=utf-8': 'https://example.com/p.txt' }
			},
			'general'
		);
		expect(ok).toBe(true);
	});

	it('requires domain keywords for ethics domain', () => {
		const noEthics = bookMatchesPhilosophyDomain(
			{
				id: 2,
				title: 'Pure mathematics primer',
				subjects: ['Philosophy'],
				bookshelves: [],
				formats: { 'text/plain': 'https://example.com/p.txt' }
			},
			'ethics'
		);
		expect(noEthics).toBe(false);

		const ethics = bookMatchesPhilosophyDomain(
			{
				id: 3,
				title: 'Fundamental Principles of the Metaphysic of Morals',
				subjects: [],
				bookshelves: [],
				formats: { 'text/plain': 'https://example.com/p.txt' }
			},
			'ethics'
		);
		expect(ethics).toBe(true);
	});

	it('rejects books without plain text', () => {
		const ok = bookMatchesPhilosophyDomain(
			{
				id: 4,
				title: 'Treatise on Philosophy',
				subjects: ['Philosophy'],
				formats: { 'application/pdf': 'https://example.com/p.pdf' }
			},
			'general'
		);
		expect(ok).toBe(false);
	});
});
