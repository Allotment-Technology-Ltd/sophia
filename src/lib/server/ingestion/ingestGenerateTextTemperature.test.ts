import { describe, expect, it } from 'vitest';
import { shouldOmitGenerateTextTemperature } from './ingestGenerateTextTemperature.js';

describe('shouldOmitGenerateTextTemperature', () => {
	it('omits for openai model paths that include /deployments/', () => {
		expect(
			shouldOmitGenerateTextTemperature(
				'extraction',
				'openai',
				'accounts/foo/deployments/bar',
				{}
			)
		).toBe(true);
	});

	it('does not omit for stock openai chat model ids', () => {
		expect(shouldOmitGenerateTextTemperature('extraction', 'openai', 'gpt-4o', {})).toBe(false);
	});

	it('respects INGEST_DISABLE_OPENAI_DEPLOYMENT_TEMPERATURE_OMIT', () => {
		expect(
			shouldOmitGenerateTextTemperature('extraction', 'openai', 'accounts/x/deployments/y', {
				INGEST_DISABLE_OPENAI_DEPLOYMENT_TEMPERATURE_OMIT: '1'
			} as NodeJS.ProcessEnv)
		).toBe(false);
	});

	it('matches INGEST_OMIT_LLM_TEMPERATURE_MODEL_SUBSTRINGS', () => {
		expect(
			shouldOmitGenerateTextTemperature('extraction', 'vertex', 'gemini-2.5-pro-preview', {
				INGEST_OMIT_LLM_TEMPERATURE_MODEL_SUBSTRINGS: 'preview,foo'
			} as NodeJS.ProcessEnv)
		).toBe(true);
	});

	it('honours INGEST_OMIT_LLM_TEMPERATURE_STAGES', () => {
		const env = {
			INGEST_OMIT_LLM_TEMPERATURE: '1',
			INGEST_OMIT_LLM_TEMPERATURE_STAGES: 'relations'
		} as NodeJS.ProcessEnv;
		expect(shouldOmitGenerateTextTemperature('extraction', 'openai', 'gpt-4o', env)).toBe(false);
		expect(shouldOmitGenerateTextTemperature('relations', 'openai', 'gpt-4o', env)).toBe(true);
	});

	it('omits for Vertex Gemini 3 models (reasoning surface rejects temperature)', () => {
		expect(
			shouldOmitGenerateTextTemperature('validation', 'vertex', 'gemini-3-flash-preview', {})
		).toBe(true);
		expect(shouldOmitGenerateTextTemperature('validation', 'google', 'gemini-3-pro-preview', {})).toBe(
			true
		);
		expect(shouldOmitGenerateTextTemperature('validation', 'vertex', 'gemini-2.5-flash', {})).toBe(
			false
		);
	});

	it('omits for AiZolo Gemini 3 carrier ids normalized to Gemini reasoning models', () => {
		expect(
			shouldOmitGenerateTextTemperature(
				'extraction',
				'aizolo',
				'aizolo-gemini-gemini-3-flash-preview',
				{}
			)
		).toBe(true);
		expect(
			shouldOmitGenerateTextTemperature('extraction', 'aizolo', 'gemini/gemini-3-flash-preview', {})
		).toBe(true);
		expect(
			shouldOmitGenerateTextTemperature('extraction', 'aizolo', 'aizolo-gemini-gemini-2.5-flash', {})
		).toBe(false);
	});
});
