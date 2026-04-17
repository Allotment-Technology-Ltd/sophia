/**
 * Standalone validation test using existing partial results
 */

import * as fs from 'fs';
import { googleAiStudioOpenAiChatCompletion } from './lib/googleAiStudioOpenAi.ts';

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3-flash-preview';

async function main() {
	console.log('╔══════════════════════════════════════════════════════╗');
	console.log('║       STANDALONE GEMINI VALIDATION TEST              ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');

	// Load partial results
	const partialPath = 'data/ingested/auth-smoke-test-partial.json';
	if (!fs.existsSync(partialPath)) {
		console.error(`❌ Partial results not found: ${partialPath}`);
		console.error('Run ingestion first without --validate flag\n');
		process.exit(1);
	}

	const partial = JSON.parse(fs.readFileSync(partialPath, 'utf-8'));

	console.log(`Source: ${partial.source.title}`);
	console.log(`Claims: ${partial.claims?.length || 0}`);
	console.log(`Relations: ${partial.relations?.length || 0}`);
	console.log(`Arguments: ${partial.arguments?.length || 0}`);
	console.log(`\nTesting validation with ${GEMINI_MODEL} (OpenAI-compat)...\n`);

	const validationPrompt = `You are validating extracted philosophical claims. Review the following claims and assess their faithfulness to the source text.

Source: ${partial.source.title}
Claims: ${JSON.stringify(partial.claims?.slice(0, 2), null, 2)}

Respond with JSON: { "summary": "brief assessment", "claims": [{"position_in_source": 0, "faithfulness_score": 85}] }`;

	try {
		const { text, usage } = await googleAiStudioOpenAiChatCompletion({
			apiKey: GOOGLE_AI_API_KEY,
			model: GEMINI_MODEL,
			userMessage: validationPrompt,
			temperature: 0.1,
			maxTokens: 1024
		});

		console.log('✅ Validation response received');
		const total =
			usage?.promptTokens != null && usage?.completionTokens != null
				? usage.promptTokens + usage.completionTokens
				: '?';
		console.log(`✅ Tokens used (approx): ${total}`);
		console.log(`\nValidation output (first 300 chars):\n${text.substring(0, 300)}...\n`);
		console.log('╔══════════════════════════════════════════════════════╗');
		console.log('║  ✅ GEMINI VALIDATION IS WORKING                    ║');
		console.log('╚══════════════════════════════════════════════════════╝\n');
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error('❌ Validation failed:', msg);
		process.exit(1);
	}
}

main();
