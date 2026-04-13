import { describe, expect, it } from 'vitest';
import { goldenExtractionEvalFingerprint, loadGoldenExtractionEval } from './goldenExtractionEval';

describe('goldenExtractionEval', () => {
	it('loads bundled JSON and produces stable fingerprint', () => {
		const data = loadGoldenExtractionEval();
		expect(data.version).toBeGreaterThanOrEqual(1);
		expect(data.items.length).toBeGreaterThan(10);
		const a = goldenExtractionEvalFingerprint(data.items);
		const b = goldenExtractionEvalFingerprint([...data.items].reverse());
		expect(a).toBe(b);
		expect(a.length).toBe(16);
	});
});
