import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const enabled = (process.env.ENABLE_LEARN_MODULE ?? 'false').toLowerCase() === 'true';
  if (!enabled) {
    throw error(404, 'Learn module is disabled');
  }
  return {
    enabled,
    publicLearnEnabled: (process.env.PUBLIC_ENABLE_LEARN_MODULE ?? 'false').toLowerCase() === 'true'
  };
};
