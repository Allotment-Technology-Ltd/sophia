import { json, type RequestHandler } from '@sveltejs/kit';
import { loadStoaProfile, upsertStoaProfile } from '$lib/server/stoa/sessionStore';

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }
  const profile = await loadStoaProfile(uid);
  return json({
    goals: profile.goals,
    triggers: profile.triggers,
    practices: profile.practices,
    stoicLevel: profile.stoicLevel ?? null,
    primaryChallenge: profile.primaryChallenge ?? null,
    intakeCompletedAt: profile.intakeCompletedAt ?? null,
    updatedAt: profile.updatedAt ?? null
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid profile payload' }, { status: 400 });
  }
  const coerce = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
      : [];
  const saved = await upsertStoaProfile({
    userId: uid,
    goals: coerce((body as Record<string, unknown>).goals),
    triggers: coerce((body as Record<string, unknown>).triggers),
    practices: coerce((body as Record<string, unknown>).practices),
    stoicLevel:
      (body as Record<string, unknown>).stoicLevel === 'some_exposure' ||
      (body as Record<string, unknown>).stoicLevel === 'regular_practitioner'
        ? ((body as Record<string, unknown>).stoicLevel as 'some_exposure' | 'regular_practitioner')
        : (body as Record<string, unknown>).stoicLevel === 'new'
          ? 'new'
          : undefined,
    primaryChallenge:
      typeof (body as Record<string, unknown>).primaryChallenge === 'string'
        ? String((body as Record<string, unknown>).primaryChallenge).trim()
        : undefined,
    intakeCompletedAt:
      typeof (body as Record<string, unknown>).intakeCompletedAt === 'string'
        ? String((body as Record<string, unknown>).intakeCompletedAt)
        : undefined,
    intakeVersion:
      typeof (body as Record<string, unknown>).intakeVersion === 'number'
        ? ((body as Record<string, unknown>).intakeVersion as number)
        : undefined
  });
  return json({
    goals: saved.goals,
    triggers: saved.triggers,
    practices: saved.practices
  });
};

