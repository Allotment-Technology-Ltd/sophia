/**
 * Quick test of Gemini via Google AI Studio OpenAI-compatible Chat Completions.
 */

import { googleAiStudioOpenAiChatCompletion } from './lib/googleAiStudioOpenAi.ts';

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';

async function main() {
	console.log('Testing gemini-3-flash-preview (OpenAI-compat)...\n');

	try {
		const { text, usage } = await googleAiStudioOpenAiChatCompletion({
			apiKey: GOOGLE_AI_API_KEY,
			model: 'gemini-3-flash-preview',
			userMessage: 'What is 2+2? Answer in one word.',
			temperature: 0.1,
			maxTokens: 64
		});

		console.log('✅ Response:', text);
		if (usage?.promptTokens != null || usage?.completionTokens != null) {
			console.log('✅ Tokens:', `${usage.promptTokens ?? '?'} in + ${usage.completionTokens ?? '?'} out`);
		}
		console.log('\n✅ gemini-3-flash-preview is working!');
	} catch (error) {
		console.error('❌ Error:', error);
		process.exitCode = 1;
	}
}

main();
