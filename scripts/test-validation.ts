/**
 * Standalone validation test using existing partial results
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';

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
	console.log(`\nTesting validation with ${GEMINI_MODEL}...\n`);
	
	const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
	const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
	
	const validationPrompt = `You are validating extracted philosophical claims. Review the following claims and assess their faithfulness to the source text.

Source: ${partial.source.title}
Claims: ${JSON.stringify(partial.claims?.slice(0, 2), null, 2)}

Respond with JSON: { "summary": "brief assessment", "claims": [{"position_in_source": 0, "faithfulness_score": 85}] }`;
	
	try {
		const result = await model.generateContent({
			contents: [{ role: 'user', parts: [{ text: validationPrompt }] }],
			generationConfig: { temperature: 0.1 }
		});
		
		const response = result.response;
		const text = response.text();
		
		console.log('✅ Validation response received');
		console.log(`✅ Tokens used: ${response.usageMetadata?.totalTokenCount || 0}`);
		console.log(`\nValidation output (first 300 chars):\n${text.substring(0, 300)}...\n`);
		console.log('╔══════════════════════════════════════════════════════╗');
		console.log('║  ✅ GEMINI VALIDATION IS WORKING                    ║');
		console.log('╚══════════════════════════════════════════════════════╝\n');
	} catch (error: any) {
		console.error('❌ Validation failed:', error.message);
		process.exit(1);
	}
}

main();
