import { json, type RequestHandler } from '@sveltejs/kit';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { loadAdminDashboardData } from '$lib/server/adminDashboard';

export const GET: RequestHandler = async ({ locals }) => {
	assertAdminAccess(locals);
	const dashboard = await loadAdminDashboardData();
	return json(dashboard);
};
