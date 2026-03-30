import { json, type RequestHandler } from '@sveltejs/kit';
import type { StoicLevel } from '$lib/server/stoa/types';
import { upsertStoaOnboarding } from '$lib/server/stoa/sessionStore';

function cleanList(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid onboarding payload' }, { status: 400 });
  }
  const stoicLevelRaw = (body as Record<string, unknown>).stoicLevel;
  const stoicLevel: StoicLevel =
    stoicLevelRaw === 'some_exposure' || stoicLevelRaw === 'regular_practitioner'
      ? stoicLevelRaw
      : 'new';
  const primaryChallenge = String((body as Record<string, unknown>).primaryChallenge ?? '').trim();
  if (!primaryChallenge) {
    return json({ error: 'primaryChallenge is required' }, { status: 400 });
  }
  const goals = cleanList((body as Record<string, unknown>).goals);
  const triggers = cleanList((body as Record<string, unknown>).triggers);
  const saved = await upsertStoaOnboarding({
    userId: uid,
    onboarding: {
      stoicLevel,
      primaryChallenge,
      goals,
      triggers,
      completedAt: new Date().toISOString(),
      intakeVersion: 1
    }
  });
  return json({
    onboardingStatus: 'complete',
    profile: {
      stoicLevel: saved.stoicLevel ?? null,
      primaryChallenge: saved.primaryChallenge ?? null,
      goals: saved.goals,
      triggers: saved.triggers,
      practices: saved.practices
    }
  });
};
