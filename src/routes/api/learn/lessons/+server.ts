import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listLessonsBySection } from '$lib/server/learn/content';
import {
  isLearnModuleEnabled,
  learnModuleDisabledResponse,
  requireUid,
  unauthorizedResponse
} from '$lib/server/learn/http';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!isLearnModuleEnabled()) return learnModuleDisabledResponse();
  if (!requireUid(locals)) return unauthorizedResponse();

  const sectionParam = url.searchParams.get('section');
  const section = sectionParam === 'practice' ? 'practice' : sectionParam === 'daily' ? 'daily' : null;
  if (!section) {
    return json({ error: 'section must be daily or practice' }, { status: 400 });
  }

  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor ? Number.parseInt(rawCursor, 10) : 0;
  if (Number.isNaN(cursor) || cursor < 0) {
    return json({ error: 'cursor must be a non-negative integer' }, { status: 400 });
  }

  const payload = await listLessonsBySection(section, { cursor, limit: 8 });

  return json({
    lessons: payload.lessons,
    next_cursor: payload.nextCursor
  });
};
