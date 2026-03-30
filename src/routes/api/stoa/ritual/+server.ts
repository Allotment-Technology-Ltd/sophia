import { json, type RequestHandler } from '@sveltejs/kit';
import { createJournalEntry, logRitualRun, upsertActionItems } from '$lib/server/stoa/sessionStore';

type RitualType = 'morning' | 'evening';

function isRitual(value: unknown): value is RitualType {
  return value === 'morning' || value === 'evening';
}

function buildRitualAction(type: RitualType, answers: Record<string, string>): string {
  if (type === 'morning') {
    const test = (answers.test ?? '').trim();
    const virtue = (answers.virtue ?? '').trim();
    return `Morning intention: Prepare for ${test || 'today’s hardest test'} with ${virtue || 'steady virtue'}.`;
  }
  const differently = (answers.differently ?? '').trim();
  return `Evening review follow-up: Tomorrow I will ${differently || 'act with more deliberate assent'}.`;
}

function buildJournalEntry(type: RitualType, answers: Record<string, string>): string {
  if (type === 'morning') {
    return `Morning ritual: I may be tested by "${answers.test ?? ''}". I want to embody "${
      answers.virtue ?? ''
    }" today.`;
  }
  return `Evening review: Went well: "${answers.wentWell ?? ''}". I'd do differently: "${
    answers.differently ?? ''
  }". Control check: "${answers.controlCheck ?? ''}".`;
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid payload' }, { status: 400 });
  const ritualTypeRaw = (body as Record<string, unknown>).ritualType;
  if (!isRitual(ritualTypeRaw)) return json({ error: 'Invalid ritualType' }, { status: 400 });
  const sessionId = String((body as Record<string, unknown>).sessionId ?? '').trim() || `ritual-${Date.now()}`;
  const answers =
    typeof (body as Record<string, unknown>).answers === 'object' &&
    (body as Record<string, unknown>).answers !== null
      ? ((body as Record<string, unknown>).answers as Record<string, unknown>)
      : {};
  const normalizedAnswers: Record<string, string> = Object.fromEntries(
    Object.entries(answers)
      .filter((entry) => typeof entry[1] === 'string')
      .map(([key, value]) => [key, String(value).trim().slice(0, 220)])
  );
  const durationSeconds = Number((body as Record<string, unknown>).durationSeconds ?? 0);
  await logRitualRun({
    userId: uid,
    sessionId,
    ritualType: ritualTypeRaw,
    answers: normalizedAnswers,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0
  });
  const actionText = buildRitualAction(ritualTypeRaw, normalizedAnswers);
  await upsertActionItems({
    userId: uid,
    sessionId,
    items: [
      {
        text: actionText,
        timeframe: ritualTypeRaw === 'morning' ? 'today' : 'this_week',
        origin: 'ritual'
      }
    ]
  });
  await createJournalEntry({
    userId: uid,
    sessionId,
    entryText: buildJournalEntry(ritualTypeRaw, normalizedAnswers),
    themes: [ritualTypeRaw === 'morning' ? 'morning_ritual' : 'evening_review']
  });
  return json({ ok: true, actionText });
};
