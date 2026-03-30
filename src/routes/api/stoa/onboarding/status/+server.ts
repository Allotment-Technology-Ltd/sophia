import { json, type RequestHandler } from '@sveltejs/kit';
import { loadStoaProfile } from '$lib/server/stoa/sessionStore';

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const profile = await loadStoaProfile(uid);
  const completed = Boolean(profile.intakeCompletedAt);
  return json({
    onboardingStatus: completed ? 'complete' : 'required',
    profile: {
      stoicLevel: profile.stoicLevel ?? null,
      primaryChallenge: profile.primaryChallenge ?? null,
      goals: profile.goals,
      triggers: profile.triggers
    }
  });
};
