import { describe, expect, it, vi, afterEach } from 'vitest';
import { deepseekPaceBucketForModel, paceDeepseekChatCompletion } from './ingestDeepseekRpsPace';

describe('deepseekPaceBucketForModel', () => {
	it('classifies reasoner models', () => {
		expect(deepseekPaceBucketForModel('deepseek-reasoner')).toBe('reasoner');
		expect(deepseekPaceBucketForModel('deepseek-r1')).toBe('reasoner');
	});

	it('classifies chat and coder as chat bucket', () => {
		expect(deepseekPaceBucketForModel('deepseek-chat')).toBe('chat');
		expect(deepseekPaceBucketForModel('deepseek-coder')).toBe('chat');
	});
});

describe('paceDeepseekChatCompletion', () => {
	afterEach(() => {
		delete process.env.INGEST_DEEPSEEK_RPS_PACING;
		delete process.env.INGEST_DEEPSEEK_MIN_INTERVAL_MS;
		delete process.env.INGEST_DEEPSEEK_PACE_INTERVAL_MS_CHAT;
		vi.restoreAllMocks();
	});

	it('no-ops when pacing disabled', async () => {
		process.env.INGEST_DEEPSEEK_RPS_PACING = '0';
		const spy = vi.spyOn(globalThis, 'setTimeout');
		await paceDeepseekChatCompletion('deepseek-chat');
		expect(spy).not.toHaveBeenCalled();
	});
});
