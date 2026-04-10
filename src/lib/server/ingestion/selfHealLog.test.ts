import { describe, expect, it } from 'vitest';
import { formatIngestSelfHealLine, INGEST_SELF_HEAL_PREFIX, parseIngestSelfHealLine } from './selfHealLog';

describe('selfHealLog', () => {
	it('round-trips v1 events', () => {
		const line = formatIngestSelfHealLine({
			v: 1,
			signal: 'recovery_agent',
			stage: 'validation',
			outcome: 'consult'
		});
		expect(line.startsWith(INGEST_SELF_HEAL_PREFIX)).toBe(true);
		expect(parseIngestSelfHealLine(line)).toEqual({
			v: 1,
			signal: 'recovery_agent',
			stage: 'validation',
			outcome: 'consult'
		});
	});

	it('returns null for invalid payload', () => {
		expect(parseIngestSelfHealLine('[INGEST_SELF_HEAL] {"v":2}')).toBeNull();
		expect(parseIngestSelfHealLine('noise')).toBeNull();
	});
});
