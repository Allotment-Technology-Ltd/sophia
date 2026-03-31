import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const next = url.searchParams.get('next');
  const dest = new URL('/early-access', url.origin);
  if (next) {
    dest.searchParams.set('next', next);
  }
  throw redirect(302, dest.pathname + dest.search);
};
