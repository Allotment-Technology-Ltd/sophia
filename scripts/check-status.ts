import { Surreal } from 'surrealdb';

async function main() {
	const db = new Surreal();
	await db.connect(process.env.SURREAL_URL || 'http://localhost:8000/rpc');
	await (db as any).signin({
		username: process.env.SURREAL_USER || 'root',
		password: process.env.SURREAL_PASS || 'root'
	});
	await db.use({
		namespace: process.env.SURREAL_NAMESPACE || 'sophia',
		database: process.env.SURREAL_DATABASE || 'sophia'
	});
	const r = await db.query(
		`SELECT canonical_url_hash, source_title, status, stage_completed, claims_extracted, relations_extracted, arguments_grouped, run_attempt_count, retry_count_total, parse_repair_attempts_total, cost_usd
		 FROM ingestion_log`
	);
	console.log(JSON.stringify(r[0], null, 2));
	await db.close();
}
main();
