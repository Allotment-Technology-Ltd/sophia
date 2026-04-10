import { describe, expect, it } from 'vitest';
import {
	assertSepPresetDiscipline,
	buildSepPresetFingerprint,
	presetFingerprintDigest16
} from './presetDiscipline.js';

describe('presetDiscipline', () => {
	it('stable digest for same env snapshot', () => {
		const env = { INGEST_VALIDATION_SAMPLE_RATE: '0.5' } as NodeJS.ProcessEnv;
		const a = buildSepPresetFingerprint(env);
		const b = buildSepPresetFingerprint(env);
		expect(presetFingerprintDigest16(a)).toBe(presetFingerprintDigest16(b));
	});

	it('digest changes when a knob changes', () => {
		const e1 = { INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION: '5000' } as NodeJS.ProcessEnv;
		const e2 = { INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION: '4000' } as NodeJS.ProcessEnv;
		expect(presetFingerprintDigest16(buildSepPresetFingerprint(e1))).not.toBe(
			presetFingerprintDigest16(buildSepPresetFingerprint(e2))
		);
	});

	it('strict mode requires profile for sep_entry', () => {
		const lines: string[] = [];
		expect(() =>
			assertSepPresetDiscipline({
				sourceType: 'sep_entry',
				mode: 'strict',
				profile: undefined,
				fingerprint: { x: 1 },
				logLine: (l) => lines.push(l)
			})
		).toThrow(/INGEST_PRESET_PROFILE/);
	});

	it('strict mode passes with profile', () => {
		assertSepPresetDiscipline({
			sourceType: 'sep_entry',
			mode: 'strict',
			profile: 'sep-benchmark-v1',
			fingerprint: {},
			logLine: () => {}
		});
	});
});
