import { Surreal } from 'surrealdb';

const db = new Surreal();
await db.connect(process.env.SURREAL_URL || 'http://localhost:8000/rpc');
await db.signin({ username: process.env.SURREAL_USER || 'root', password: process.env.SURREAL_PASS || 'root' } as any);
await db.use({ namespace: process.env.SURREAL_NAMESPACE || 'sophia', database: process.env.SURREAL_DATABASE || 'sophia' });

const result = await db.query<Array<{id: string, text: string, embedding: number[] | null}[]>>('SELECT id, text, embedding FROM claim LIMIT 3');
console.log('Sample claims:');
for (const claim of result[0] || []) {
  console.log(`  ${claim.id}: embedding dim = ${claim.embedding?.length || 'null'}`);
  if (claim.embedding && claim.embedding.length > 0) {
    const firstVals = claim.embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ');
    console.log(`    First 5 values: [${firstVals}]`);
    // Check if all zeros
    const allZeros = claim.embedding.every(v => v === 0);
    console.log(`    All zeros: ${allZeros}`);
  }
}

await db.close();
