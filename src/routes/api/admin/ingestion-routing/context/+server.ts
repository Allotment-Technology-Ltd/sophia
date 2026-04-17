import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import {
  RESTORMEL_ENVIRONMENT_ID,
  getRestormelIngestWorkerDiagnostics,
  restormelGetProvidersHealth,
  restormelGetRoutingCapabilities,
  restormelGetSwitchCriteriaEnums,
  restormelListRoutes
} from '$lib/server/restormel';
import { getRestormelRecommendationSupport } from '$lib/server/restormelRecommendations';
import { serializeRestormelError } from '$lib/server/restormelAdmin';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);

  const [capabilities, switchCriteria, providersHealth, routes] = await Promise.allSettled([
    restormelGetRoutingCapabilities(),
    restormelGetSwitchCriteriaEnums(),
    restormelGetProvidersHealth(),
    restormelListRoutes()
  ]);

  const ingestWorkerDiagnostics = await getRestormelIngestWorkerDiagnostics();

  return json({
    environmentId: RESTORMEL_ENVIRONMENT_ID,
    ingestWorkerDiagnostics,
    recommendations: getRestormelRecommendationSupport(),
    capabilities: capabilities.status === 'fulfilled' ? capabilities.value.data : null,
    switchCriteria: switchCriteria.status === 'fulfilled' ? switchCriteria.value.data : null,
    providersHealth: providersHealth.status === 'fulfilled' ? providersHealth.value.data : null,
    routes: routes.status === 'fulfilled' ? routes.value.data : [],
    errors: {
      capabilities:
        capabilities.status === 'rejected' ? serializeRestormelError(capabilities.reason) : null,
      switchCriteria:
        switchCriteria.status === 'rejected' ? serializeRestormelError(switchCriteria.reason) : null,
      providersHealth:
        providersHealth.status === 'rejected'
          ? serializeRestormelError(providersHealth.reason)
          : null,
      routes: routes.status === 'rejected' ? serializeRestormelError(routes.reason) : null
    }
  });
};
