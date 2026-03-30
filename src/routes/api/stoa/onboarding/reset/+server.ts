import { json, type RequestHandler } from '@sveltejs/kit';
import { resetStoaOnboarding } from '$lib/server/stoa/sessionStore';

export const POST: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  await resetStoaOnboarding(uid);
  return json({ onboardingStatus: 'required' });
};
