import 'dotenv/config';
import { Surreal } from 'surrealdb';

async function main() {
	const db = new Surreal();
	await db.connect(process.env.SURREAL_URL || 'http://localhost:8000/rpc');
	await db.signin({
		username: process.env.SURREAL_USER || 'root',
		password: process.env.SURREAL_PASS || 'root'
	} as any);
	await db.use({
		namespace: process.env.SURREAL_NAMESPACE || 'sophia',
		database: process.env.SURREAL_DATABASE || 'sophia'
	});

	console.log('\n╔══════════════════════════════════════════════════════╗');
	console.log('║        SURREALDB VERIFICATION - RECORD COUNTS        ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');

	const tables = [
		'source',
		'claim',
		'argument',
		'supports',
		'contradicts',
		'depends_on',
		'responds_to',
		'refines',
		'exemplifies'
	];

	for (const table of tables) {
		const result = await db.query(`SELECT count() AS count FROM ${table} GROUP ALL;`);
		const count = Array.isArray(result?.[0])
			? result[0]?.[0]?.count
			: result?.[0]?.result?.[0]?.count ?? result?.[0]?.count ?? 0;
		console.log(`  ${table.padEnd(15)}: ${count}`);
	}

	console.log('\n╔══════════════════════════════════════════════════════╗');
	console.log('║           GRAPH TRAVERSAL TEST (5 claims)           ║');
	console.log('╚══════════════════════════════════════════════════════╝\n');

	const graphRaw = await db.query(
		'SELECT *, ->depends_on->claim AS premises, <-contradicts<-claim AS objectors FROM claim LIMIT 5;'
	);
	const rows = Array.isArray(graphRaw?.[0]) ? graphRaw[0] : graphRaw?.[0]?.result || [];

	for (const claim of rows || []) {
		console.log(`Claim: ${claim.id}`);
		console.log(`  Text: ${(claim.text || '').slice(0, 80)}...`);
		console.log(`  Type: ${claim.claim_type}`);
		console.log(`  Premises: ${(claim.premises || []).length}`);
		console.log(`  Objectors: ${(claim.objectors || []).length}`);
		console.log('');
	}

	await db.close();
	console.log('✓ Verification complete\n');
}

main();
