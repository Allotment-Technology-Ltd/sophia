import type { PageServerLoad } from './$types';
import { logServerAnalytics } from '$lib/server/analytics';

export const load: PageServerLoad = async ({ locals }) => {
  await logServerAnalytics({
    event: 'developer_portal_view',
    uid: locals.user?.uid ?? null,
    route: '/developer',
    success: true,
    status: 200
  });

  await logServerAnalytics({
    event: 'developer_quickstart_view',
    uid: locals.user?.uid ?? null,
    route: '/developer',
    success: true,
    status: 200
  });

  return {
    user: locals.user ?? null
  };
};
