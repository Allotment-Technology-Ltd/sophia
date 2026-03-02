import { embedQuery } from '../src/lib/server/embeddings';

console.log('Testing Vertex AI embedding...');
console.log('Project ID:', process.env.GOOGLE_VERTEX_PROJECT || process.env.GCP_PROJECT_ID);
console.log('Location:', process.env.GOOGLE_VERTEX_LOCATION || process.env.GCP_LOCATION || 'us-central1');

try {
  const testQuery = "Is moral relativism defensible?";
  console.log(`\nEmbedding query: "${testQuery}"`);
  
  const embedding = await embedQuery(testQuery);
  
  console.log(`✓ Got embedding:`);
  console.log(`  - Dimension: ${embedding.length}`);
  console.log(`  - First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
  console.log(`  - All zeros: ${embedding.every(v => v === 0)}`);
  console.log(`  - Min value: ${Math.min(...embedding).toFixed(4)}`);
  console.log(`  - Max value: ${Math.max(...embedding).toFixed(4)}`);
} catch (error) {
  console.error('✗ Error:', error);
  if (error instanceof Error) {
    console.error('Stack:', error.stack);
  }
}
