import { Surreal } from 'surrealdb';
import { embedQuery } from '../src/lib/server/embeddings';

const db = new Surreal();
await db.connect(process.env.SURREAL_URL || 'http://localhost:8000/rpc');
await db.signin({ username: process.env.SURREAL_USER || 'root', password: process.env.SURREAL_PASS || 'root' } as any);
await db.use({ namespace: process.env.SURREAL_NAMESPACE || 'sophia', database: process.env.SURREAL_DATABASE || 'sophia' });

// First check how many claims have embeddings
const embedCounts = await db.query('SELECT count() as count FROM claim WHERE embedding IS NOT NULL GROUP ALL');
console.log('Claims with embeddings:', embedCounts[0]?.[0]);

// Test query
const testQuery = "Is moral relativism defensible?";
console.log(`\nEmbedding test query: "${testQuery}"`);

const testEmbedding = await embedQuery(testQuery);
console.log(`Query embedding: ${testEmbedding.length} dimensions`);
console.log(`  First 5: [${testEmbedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);

// Check embedding has valid values
const hasNaN = testEmbedding.some(v => !isFinite(v));
const hasZeros = testEmbedding.every(v => v === 0);
console.log(`  Has NaN: ${hasNaN}`);
console.log(`  All zeros: ${hasZeros}`);

// Now try vector search
console.log(`\nTesting vector search with topK=5...`);

try {
  const ef = Math.max(16, Math.min(512, parseInt(process.env.RETRIEVAL_KNN_EF || '64', 10) || 64));
  let results;
  try {
    results = await db.query(`
    SELECT
      id,
      text,
      confidence
    FROM claim
    WHERE embedding <|5,${ef}|> $query_embedding
    LIMIT 5
  `, {
    query_embedding: testEmbedding
  });
  } catch {
    results = await db.query(`
    SELECT
      id,
      text,
      confidence
    FROM claim
    WHERE embedding <|5|> $query_embedding
    LIMIT 5
  `, {
    query_embedding: testEmbedding
  });
  }
  
  console.log('Vector search results:', results[0]?.length || 0, 'claims');
  for (const claim of results[0] || []) {
    console.log(`  - ${claim.id}: ${claim.text?.substring(0, 60)}...`);
  }
} catch (error) {
  console.error('Vector search error:', error);
}

// Check how many total have embedding field values
const nonNullEmbeddings = await db.query('SELECT COUNT () as count FROM claim WHERE embedding IS NOT NULL');
console.log('\nNon-null embeddings:', nonNullEmbeddings[0]?.[0]);

const hasEmbeddings = await db.query('SELECT id FROM claim WHERE embedding IS NOT NULL LIMIT 1');
console.log('Sample claim with embedding:', hasEmbeddings[0]?.[0]?.id);

await db.close();
