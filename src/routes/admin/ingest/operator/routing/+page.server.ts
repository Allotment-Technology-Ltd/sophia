import { RESTORMEL_ENVIRONMENT_ID } from '$lib/server/restormel';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
  restormelEnvironmentId: RESTORMEL_ENVIRONMENT_ID
});
