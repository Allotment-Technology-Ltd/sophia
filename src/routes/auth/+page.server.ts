import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const next = url.searchParams.get('next');
  if (next) {
    const dest = new URL('/early-access', url.origin);
    dest.searchParams.set('next', next);
    throw redirect(302, dest.pathname + dest.search);
  }
  throw redirect(302, '/early-access');
};
