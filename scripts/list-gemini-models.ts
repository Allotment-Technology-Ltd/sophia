/**
 * List available Gemini models
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';

if (!GOOGLE_AI_API_KEY) {
	console.error('GOOGLE_AI_API_KEY not set');
	process.exit(1);
}

async function main() {
	const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
	
	console.log('Fetching available Gemini models...\n');
	
	try {
		// @ts-ignore - listModels may not be in types
		const models = await genAI.listModels?.();
		
		if (models) {
			console.log('Available models:');
			for (const model of models) {
				console.log(`  - ${model.name || model}`);
			}
		} else {
			console.log('listModels() not available, trying common model names...\n');
			
			const testModels = [
				'gemini-pro',
				'gemini-1.0-pro',
				'gemini-2.5-flash',
				'gemini-2.5-flash-lite',
				'gemini-2.5-pro',
				'models/gemini-pro',
				'models/gemini-2.5-flash'
			];
			
			for (const modelName of testModels) {
				try {
					const model = genAI.getGenerativeModel({ model: modelName });
					await model.generateContent({
						contents: [{ role: 'user', parts: [{ text: 'test' }] }]
					});
					console.log(`  ✅ ${modelName} - AVAILABLE`);
				} catch (error: any) {
					if (error.message?.includes('404')) {
						console.log(`  ❌ ${modelName} - NOT FOUND (404)`);
					} else if (error.message?.includes('API key')) {
						console.log(`  ⚠️  ${modelName} - API KEY ISSUE`);
					} else {
						console.log(`  ✅ ${modelName} - AVAILABLE (error was not 404: ${error.message?.substring(0, 50)})`);
					}
				}
			}
		}
	} catch (error) {
		console.error('Error:', error);
	}
}

main();
