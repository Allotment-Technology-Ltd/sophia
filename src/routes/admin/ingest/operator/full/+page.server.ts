import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** “Full pipeline” overlapped durable jobs + activity; hub + jobs list cover this. */
export const load: PageServerLoad = ({ url }) => {
	throw redirect(307, `/admin/ingest/operator${url.search}`);
};
