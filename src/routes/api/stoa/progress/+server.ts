import { json, type RequestHandler } from '@sveltejs/kit';
import { getProgress, listQuestCompletions } from '$lib/server/stoa/game/progress-store';
import { getReasoningTrend } from '$lib/server/stoa/game/reasoning-progression';

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const [progress, completions, reasoningTrend] = await Promise.all([
    getProgress(uid),
    listQuestCompletions(uid),
    getReasoningTrend(uid, 10)
  ]);
  return json({
    ...progress,
    reasoningTrend: reasoningTrend.direction,
    questCompletions: completions
  });
};

