/**
 * Optional checks before durable job work: Restormel Dashboard API reachable (resolve/catalog surfaces).
 */
import { restormelGetProvidersHealth } from '$lib/server/restormel';

export async function runIngestionJobPreflightOrThrow(): Promise<void> {
	await restormelGetProvidersHealth();
}
