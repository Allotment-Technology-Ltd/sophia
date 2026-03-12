import { describe, expect, it } from 'vitest';
import {
	canonicalizeAndHashSourceUrl,
	canonicalizeSourceUrl,
	hashCanonicalUrl
} from './sourceIdentity';

describe('canonicalizeSourceUrl', () => {
	it('strips fragments and trailing slashes', () => {
		expect(
			canonicalizeSourceUrl('https://plato.stanford.edu/entries/identity-ethics/#section-1')
		).toBe('https://plato.stanford.edu/entries/identity-ethics');
	});

	it('rejects unsupported protocols', () => {
		expect(canonicalizeSourceUrl('file:///tmp/test.txt')).toBeNull();
		expect(canonicalizeSourceUrl('mailto:test@example.com')).toBeNull();
	});

	it('preserves query strings', () => {
		expect(canonicalizeSourceUrl('https://example.com/a/?b=1#frag')).toBe(
			'https://example.com/a?b=1'
		);
	});
});

describe('hashCanonicalUrl', () => {
	it('returns a stable sha256 hex digest', () => {
		expect(hashCanonicalUrl('https://example.com/a')).toBe(
			'2dce0a4c50441bfccfa9caf4b58c3cba6e06c420505dd829f0436de1aa44baac'
		);
	});
});

describe('canonicalizeAndHashSourceUrl', () => {
	it('returns both canonical url and hash', () => {
		expect(canonicalizeAndHashSourceUrl('https://example.com/a/#x')).toEqual({
			canonicalUrl: 'https://example.com/a',
			canonicalUrlHash: '2dce0a4c50441bfccfa9caf4b58c3cba6e06c420505dd829f0436de1aa44baac'
		});
	});
});
