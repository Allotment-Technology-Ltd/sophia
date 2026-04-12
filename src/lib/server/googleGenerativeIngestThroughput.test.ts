import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isGoogleGenerativePlanProvider,
	isGoogleGenerativeThroughputEnabled
} from './googleGenerativeIngestThroughput.js';

describe('googleGenerativeIngestThroughput', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('treats vertex and google as Google generative providers', () => {
		expect(isGoogleGenerativePlanProvider('vertex')).toBe(true);
		expect(isGoogleGenerativePlanProvider('google')).toBe(true);
		expect(isGoogleGenerativePlanProvider('Vertex')).toBe(true);
		expect(isGoogleGenerativePlanProvider('anthropic')).toBe(false);
		expect(isGoogleGenerativePlanProvider(undefined)).toBe(false);
	});

	it('disables throughput when INGEST_GOOGLE_GENERATIVE_THROUGHPUT=0', () => {
		vi.stubEnv('INGEST_GOOGLE_GENERATIVE_THROUGHPUT', '0');
		expect(isGoogleGenerativeThroughputEnabled()).toBe(false);
	});

	it('enables throughput by default', () => {
		expect(isGoogleGenerativeThroughputEnabled()).toBe(true);
	});
});
