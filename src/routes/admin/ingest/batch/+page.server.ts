import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** STOA batch wizard removed from product nav; use the operator hub + durable jobs. */
export const load: PageServerLoad = ({ url }) => {
	throw redirect(307, `/admin/ingest/operator${url.search}`);
};
