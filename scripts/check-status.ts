import { Surreal } from 'surrealdb';

async function main() {
  const db = new Surreal();
  await db.connect('http://35.246.25.125:8000/rpc');
  await (db as any).signin({ username: process.env.SURREAL_USER || 'root', password: process.env.SURREAL_PASS || 'root' });
  await db.use({ namespace: 'sophia', database: 'sophia' });
  const r = await db.query('SELECT source_title, status, stage_completed, claims_extracted FROM ingestion_log ');
  console.log(JSON.stringify(r[0], null, 2));
  await db.close();
}
main();
