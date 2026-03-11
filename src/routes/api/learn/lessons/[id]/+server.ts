import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLessonById } from '$lib/server/learn/content';
import {
  isLearnModuleEnabled,
  learnModuleDisabledResponse,
  requireUid,
  unauthorizedResponse
} from '$lib/server/learn/http';

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!isLearnModuleEnabled()) return learnModuleDisabledResponse();
  if (!requireUid(locals)) return unauthorizedResponse();

  const lesson = await getLessonById(params.id);
  if (!lesson) {
    return json({ error: 'lesson_not_found' }, { status: 404 });
  }

  return json({ lesson });
};
