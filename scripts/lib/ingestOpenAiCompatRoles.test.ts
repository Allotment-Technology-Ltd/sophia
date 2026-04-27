import { afterEach, describe, expect, it } from 'vitest';
import { shouldFoldSystemPromptIntoUserForProvider } from './ingestOpenAiCompatRoles';

describe('shouldFoldSystemPromptIntoUserForProvider', () => {
	afterEach(() => {
		delete process.env.EXTRACTION_BASE_URL;
	});

	it('folds system prompts for AiZolo chat completions compatibility', () => {
		expect(shouldFoldSystemPromptIntoUserForProvider('aizolo')).toBe(true);
	});

	it('keeps native OpenAI system prompts unless an extraction-compatible base requires folding', () => {
		expect(shouldFoldSystemPromptIntoUserForProvider('openai')).toBe(false);
		process.env.EXTRACTION_BASE_URL = 'https://api.fireworks.ai/inference/v1';
		expect(shouldFoldSystemPromptIntoUserForProvider('openai')).toBe(true);
	});
});
