import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Former “Expand” entry: deep links with run/report monitoring still use `legacy-wizard`. */
export const load: PageServerLoad = ({ url }) => {
	const hasLegacyMonitor =
		url.searchParams.has('runId') ||
		url.searchParams.has('reportRunId') ||
		url.searchParams.get('monitor') === '1';
	if (hasLegacyMonitor) {
		throw redirect(307, `/admin/ingest/legacy-wizard${url.search}`);
	}
	throw redirect(307, `/admin/ingest/operator${url.search}`);
};
