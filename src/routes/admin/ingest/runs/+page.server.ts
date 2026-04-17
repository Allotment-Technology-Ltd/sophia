import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Merged into operator Activity — one place for in-memory runs, jobs, Neon promote, and Firestore report rows. */
export const load: PageServerLoad = ({ url }) => {
	throw redirect(307, `/admin/ingest/operator/activity${url.search}`);
};
