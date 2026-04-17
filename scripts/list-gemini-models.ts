/**
 * List available Gemini models (Generative Language REST) and probe names via OpenAI-compat chat.
 * Avoids @google/generative-ai so behaviour matches production OpenAI-route inference.
 */

import { googleAiStudioOpenAiChatCompletion } from './lib/googleAiStudioOpenAi.ts';

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';

if (!GOOGLE_AI_API_KEY) {
	console.error('GOOGLE_AI_API_KEY not set');
	process.exit(1);
}

async function listModelsRest(): Promise<void> {
	const url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';
	const res = await fetch(url, {
		headers: { 'x-goog-api-key': GOOGLE_AI_API_KEY.trim() }
	});
	const raw = (await res.json().catch(() => ({}))) as { models?: Array<{ name?: string }> };
	if (!res.ok) {
		console.error(`List models HTTP ${res.status}:`, JSON.stringify(raw));
		return;
	}
	if (raw.models?.length) {
		console.log('Available models (v1beta/models):');
		for (const m of raw.models) {
			console.log(`  - ${m.name ?? '(unnamed)'}`);
		}
		return;
	}
	console.log('No models in response; falling back to name probes.\n');
}

async function main() {
	console.log('Fetching available Gemini models...\n');

	try {
		await listModelsRest();
		console.log('\nOpenAI-compat probe (chat/completions) for common ids:\n');

		const testModels = [
			'gemini-pro',
			'gemini-1.0-pro',
			'gemini-3-flash-preview',
			'gemini-3.1-flash-lite-preview',
			'gemini-3.1-pro-preview',
			'models/gemini-pro',
			'models/gemini-3-flash-preview'
		];

		for (const modelName of testModels) {
			try {
				await googleAiStudioOpenAiChatCompletion({
					apiKey: GOOGLE_AI_API_KEY,
					model: modelName,
					userMessage: 'ping',
					temperature: 0.1,
					maxTokens: 8
				});
				console.log(`  ✅ ${modelName} — responds on OpenAI-compat`);
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				if (msg.includes('404') || msg.includes('not found')) {
					console.log(`  ❌ ${modelName} — not found`);
				} else if (msg.includes('API key') || msg.includes('401')) {
					console.log(`  ⚠️  ${modelName} — API key issue`);
				} else {
					console.log(`  ⚠️  ${modelName} — ${msg.substring(0, 120)}`);
				}
			}
		}
	} catch (error) {
		console.error('Error:', error);
		process.exitCode = 1;
	}
}

main();
