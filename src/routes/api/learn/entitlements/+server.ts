import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLearnEntitlementSummary } from '$lib/server/learn/entitlements';
import {
  isLearnModuleEnabled,
  learnModuleDisabledResponse,
  requireUid,
  unauthorizedResponse
} from '$lib/server/learn/http';

export const GET: RequestHandler = async ({ locals }) => {
  if (!isLearnModuleEnabled()) return learnModuleDisabledResponse();
  const uid = requireUid(locals);
  if (!uid) return unauthorizedResponse();

  const summary = await getLearnEntitlementSummary(uid);
  return json({ summary });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!isLearnModuleEnabled()) return learnModuleDisabledResponse();
  const uid = requireUid(locals);
  if (!uid) return unauthorizedResponse();

  await request.arrayBuffer();
  return json({ error: 'learn_credit_payments_removed' }, { status: 410 });
};
