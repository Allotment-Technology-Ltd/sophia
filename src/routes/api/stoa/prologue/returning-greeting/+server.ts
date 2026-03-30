import { json, type RequestHandler } from '@sveltejs/kit';
import { query } from '$lib/server/db';
import { getProgress } from '$lib/server/stoa/game/progress-store';
import { ALL_QUESTS } from '$lib/server/stoa/game/quest-definitions';
import { daysSinceLastSession, getStoaProfile } from '$lib/server/stoa/profile-store';
import { selectReturningGreeting } from '$lib/server/stoa/prologue/script';
import type { StanceType, StoaProgressState } from '$lib/types/stoa';

type LastSessionRow = {
  dominant_stance?: StanceType | null;
  updated_at?: string;
  last_active?: string;
  started_at?: string;
};

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const profile = await getStoaProfile(uid);
  if (!profile) {
    return json({ error: 'Profile not found' }, { status: 404 });
  }

  const [lastSession] = await query<LastSessionRow[]>(
    `SELECT dominant_stance, updated_at, last_active, started_at
     FROM stoa_session
     WHERE user_id = <record<user>>$userRecord
     ORDER BY last_active DESC
     LIMIT 1`,
    { userRecord: `user:${uid}` }
  );

  const progress = await getProgress(uid).catch(
    (): StoaProgressState => ({
      xp: 0,
      level: 1,
      unlockedThinkers: [],
      masteredFrameworks: [],
      activeQuestIds: [],
      completedQuestIds: []
    })
  );

  const activeQuests = ALL_QUESTS.filter((quest) => progress.activeQuestIds.includes(quest.id));
  const completedQuests = ALL_QUESTS.filter((quest) => progress.completedQuestIds.includes(quest.id));
  const recentCompletion = completedQuests.length > 0 ? completedQuests[completedQuests.length - 1]?.title : undefined;
  const isFirstQuestComplete = progress.completedQuestIds.length > 0;

  const daysSince = await daysSinceLastSession(uid);
  const greeting = selectReturningGreeting({
    startingPath: profile.startingPath,
    daysSince,
    lastStance: lastSession?.dominant_stance ?? profile.suggestedOpeningStance ?? null,
    hasActiveQuest: activeQuests.length > 0,
    activeQuestTitle: activeQuests[0]?.title,
    recentCompletion,
    totalSessions: profile.totalSessions,
    isFirstQuestComplete
  });

  return json({
    variant: greeting.variant,
    lines: greeting.lines,
    startingPath: profile.startingPath
  });
};
