import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Former “legacy wizard” URL — monitoring and reports live on `run-console`. */
export const load: PageServerLoad = ({ url }) => {
	throw redirect(307, `/admin/ingest/run-console${url.search}`);
};
