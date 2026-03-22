import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  throw redirect(307, `/admin/ingest${url.search}`);
};
