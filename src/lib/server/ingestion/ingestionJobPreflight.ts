/**
 * Optional checks before durable job work: Restormel Dashboard API reachable (resolve/catalog surfaces).
 */
import { restormelGetProvidersHealth } from '$lib/server/restormel';

export async function runIngestionJobPreflightOrThrow(): Promise<void> {
	const base = process.env.RESTORMEL_DASHBOARD_API_BASE?.trim();
	const key = process.env.RESTORMEL_DASHBOARD_API_KEY?.trim();
	if (!base || !key) {
		throw new Error(
			'INGEST_JOB_PREFLIGHT requires RESTORMEL_DASHBOARD_API_BASE and RESTORMEL_DASHBOARD_API_KEY'
		);
	}
	await restormelGetProvidersHealth();
}
