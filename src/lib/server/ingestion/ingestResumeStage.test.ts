import { describe, expect, it } from 'vitest';
import {
	completedStageOrderRank,
	ingestionLogStatusReflectingCheckpoint,
	laterCompletedStage,
	validationOnlyEmbeddingCheckpointMet
} from './ingestResumeStage';

describe('ingestResumeStage', () => {
	it('laterCompletedStage picks the later checkpoint for validation floor vs remediation log', () => {
		expect(laterCompletedStage('remediating', 'embedding')).toBe('remediating');
		expect(laterCompletedStage('embedding', 'remediating')).toBe('remediating');
	});

	it('laterCompletedStage keeps floor when log is missing or earlier', () => {
		expect(laterCompletedStage(null, 'embedding')).toBe('embedding');
		expect(laterCompletedStage('grouping', 'embedding')).toBe('embedding');
	});

	it('validationOnlyEmbeddingCheckpointMet accepts embedding or later', () => {
		expect(validationOnlyEmbeddingCheckpointMet('grouping')).toBe(false);
		expect(validationOnlyEmbeddingCheckpointMet('embedding')).toBe(true);
		expect(validationOnlyEmbeddingCheckpointMet('validating')).toBe(true);
		expect(validationOnlyEmbeddingCheckpointMet('remediating')).toBe(true);
	});

	it('completedStageOrderRank treats stored as past storing', () => {
		expect(completedStageOrderRank('storing')).toBeLessThan(completedStageOrderRank('stored'));
	});

	it('ingestionLogStatusReflectingCheckpoint matches Surreal status ASSERT semantics', () => {
		expect(ingestionLogStatusReflectingCheckpoint(null)).toBe('extracting');
		expect(ingestionLogStatusReflectingCheckpoint('extracting')).toBe('relating');
		expect(ingestionLogStatusReflectingCheckpoint('embedding')).toBe('validating');
		expect(ingestionLogStatusReflectingCheckpoint('validating')).toBe('validating');
		expect(ingestionLogStatusReflectingCheckpoint('remediating')).toBe('storing');
		expect(ingestionLogStatusReflectingCheckpoint('storing')).toBe('storing');
	});
});
