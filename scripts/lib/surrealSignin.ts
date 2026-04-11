/**
 * SurrealDB `signin` payloads aligned with `scripts/ingest.ts` (historical `signinSurrealWithFallback`).
 * Use for read-only audit scripts and tooling against **local** or **Surreal Cloud** endpoints.
 *
 * **URL resolution:** use `resolveSurrealRpcUrl()` from `src/lib/server/surrealEnv.ts` before `connect`.
 *
 * Credentials are **never** stored in git — set `SURREAL_*` in `.env` / `.env.local` (see `.env.example`).
 */
import type { Surreal } from 'surrealdb';

const NS = () => process.env.SURREAL_NAMESPACE || 'sophia';
const DB = () => process.env.SURREAL_DATABASE || 'sophia';
const USER = () => process.env.SURREAL_USER || 'root';
const PASS = () => process.env.SURREAL_PASS || 'root';

/**
 * Try root/basic, then namespace-scoped basic, then NS/DB shorthand (covers Surreal Cloud quirks).
 * Optional `SURREAL_ACCESS` / `SURREAL_RECORD_ACCESS` adds access-record signin attempts (see ingest.ts).
 */
export async function signinSurrealWithFallback(db: Surreal): Promise<void> {
	const access = (process.env.SURREAL_ACCESS || process.env.SURREAL_RECORD_ACCESS || '').trim();
	const ns = NS();
	const dbName = DB();
	const user = USER();
	const pass = PASS();

	const attempts: Array<{ label: string; payload: Record<string, unknown> }> = [
		{ label: 'root/basic', payload: { username: user, password: pass } },
		{
			label: 'namespace/basic',
			payload: { namespace: ns, database: dbName, username: user, password: pass }
		},
		{
			label: 'namespace/shorthand',
			payload: { NS: ns, DB: dbName, user, pass }
		}
	];

	if (access) {
		attempts.push({
			label: `access/${access}`,
			payload: {
				namespace: ns,
				database: dbName,
				access,
				username: user,
				password: pass
			}
		});
		attempts.push({
			label: `access-shorthand/${access}`,
			payload: { NS: ns, DB: dbName, AC: access, user, pass }
		});
	}

	let lastError: unknown;
	for (const attempt of attempts) {
		try {
			await (db as { signin: (c: Record<string, unknown>) => Promise<unknown> }).signin(
				attempt.payload as Record<string, unknown>
			);
			if (attempt.label !== 'root/basic') {
				console.log(`  [DB] Signed in via ${attempt.label} auth mode.`);
			}
			return;
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Unknown Surreal signin error'));
}
