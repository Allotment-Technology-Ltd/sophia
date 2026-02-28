/**
 * Test Gemini API directly via REST
 */

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';

if (!GOOGLE_AI_API_KEY) {
	console.error('GOOGLE_AI_API_KEY not set');
	process.exit(1);
}

async function main() {
	console.log('Testing Gemini API key...\n');
	
	// Try to list models via REST API
	const modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_AI_API_KEY}`;
	
	try {
		console.log('Fetching model list from REST API...');
		const response = await fetch(modelsUrl);
		
		if (!response.ok) {
			console.error(`❌ Error: ${response.status} ${response.statusText}`);
			const text = await response.text();
			console.error('Response:', text.substring(0, 500));
			
			if (response.status === 403) {
				console.error('\n⚠️  API key may not have access to Gemini API');
				console.error('Check: https://aistudio.google.com/app/apikey');
			}
			return;
		}
		
		const data = await response.json();
		
		if (data.models && Array.isArray(data.models)) {
			console.log(`✅ Found ${data.models.length} models:\n`);
			
			const generativeModels = data.models.filter((m: any) => 
				m.supportedGenerationMethods?.includes('generateContent')
			);
			
			console.log('Models supporting generateContent:');
			for (const model of generativeModels) {
				const name = model.name.replace('models/', '');
				console.log(`  - ${name}`);
			}
			
			if (generativeModels.length === 0) {
				console.log('\n⚠️  No models support generateContent method');
			}
		} else {
			console.log('Unexpected response format:', JSON.stringify(data, null, 2).substring(0, 500));
		}
	} catch (error) {
		console.error('❌ Error:', error);
	}
}

main();
