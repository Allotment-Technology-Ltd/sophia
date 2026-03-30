import { json, type RequestHandler } from '@sveltejs/kit';
import {
  listCurriculumWeeks,
  loadCurriculumProgress,
  upsertCurriculumProgress
} from '$lib/server/stoa/sessionStore';

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const weeks = listCurriculumWeeks();
  const progress = await loadCurriculumProgress(uid);
  const current = weeks.find((week) => week.weekNumber === progress.currentWeek) ?? weeks[0];
  return json({ weeks, progress, currentWeek: current });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const uid = locals.user?.uid;
  if (!uid) return json({ error: 'Authentication required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid payload' }, { status: 400 });
  const currentWeek = Number((body as Record<string, unknown>).currentWeek ?? 1);
  const completedWeeks = Array.isArray((body as Record<string, unknown>).completedWeeks)
    ? ((body as Record<string, unknown>).completedWeeks as number[])
    : [];
  const paceMode =
    (body as Record<string, unknown>).paceMode === 'calendar_week' ? 'calendar_week' : 'rolling_7_day';
  const progress = await upsertCurriculumProgress({
    userId: uid,
    currentWeek: Number.isFinite(currentWeek) ? currentWeek : 1,
    completedWeeks: completedWeeks.filter((n) => Number.isFinite(n)),
    paceMode
  });
  return json({ progress });
};
