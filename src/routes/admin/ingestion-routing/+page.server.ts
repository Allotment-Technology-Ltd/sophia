import type { PageServerLoad } from './$types';
import { RESTORMEL_BASE_URL, RESTORMEL_DASHBOARD_API_BASE } from '$lib/server/restormel';

export const load: PageServerLoad = async () => {
	const policiesEvaluateUrl =
		process.env.RESTORMEL_EVALUATE_URL?.trim() ||
		`${RESTORMEL_DASHBOARD_API_BASE}/policies/evaluate`;

	return {
		mcpRestormel: {
			dashboardBaseUrl: RESTORMEL_BASE_URL,
			policiesEvaluateUrl,
			integrationDocsUrl: 'https://restormel.dev/keys/docs/integrations/mcp'
		}
	};
};
