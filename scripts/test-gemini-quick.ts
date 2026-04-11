/**
 * Quick test of Gemini 2.5 Flash
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';

async function main() {
	console.log('Testing gemini-3-flash-preview...\n');
	
	const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
	const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
	
	try {
		const result = await model.generateContent({
			contents: [{ 
				role: 'user', 
				parts: [{ text: 'What is 2+2? Answer in one word.' }] 
			}],
			generationConfig: { temperature: 0.1 }
		});
		
		const response = result.response;
		console.log('✅ Response:', response.text());
		console.log('✅ Tokens:', response.usageMetadata?.totalTokenCount || 0);
		console.log('\n✅ gemini-3-flash-preview is working!');
	} catch (error) {
		console.error('❌ Error:', error);
	}
}

main();
