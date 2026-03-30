import { isDatabaseUnavailable, query } from '$lib/server/db';
import type {
  ActionItemStatus,
  ActionLoopTimeframe,
  ConversationTurn,
  CurriculumProgress,
  CurriculumWeek,
  JournalEntry,
  SessionState,
  StoaActionItem,
  StoaOnboardingProfile,
  StoicLevel
} from './types';

type SessionRow = {
  id?: string;
  session_id?: string;
  user_id?: string;
  summary?: string;
  updated_at?: string;
};

type TurnRow = {
  role?: 'user' | 'agent';
  content?: string;
  timestamp?: string;
  stance?: string;
  frameworks_referenced?: string[];
};

export interface StoaProfile {
  userId: string;
  goals: string[];
  triggers: string[];
  practices: string[];
  stoicLevel?: StoicLevel | null;
  primaryChallenge?: string | null;
  intakeCompletedAt?: string | null;
  intakeVersion?: number;
  updatedAt?: string | null;
}

let stoaTablesEnsured = false;

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('table') && (message.includes('not found') || message.includes('does not exist'));
}

async function ensureStoaTables(): Promise<void> {
  if (stoaTablesEnsured) return;
  await query(`
    DEFINE TABLE IF NOT EXISTS stoa_session SCHEMALESS;
    DEFINE TABLE IF NOT EXISTS stoa_session_turn SCHEMALESS;
    DEFINE TABLE IF NOT EXISTS stoa_profile SCHEMALESS;
    DEFINE TABLE IF NOT EXISTS stoa_action_item SCHEMALESS;
    DEFINE TABLE IF NOT EXISTS stoa_journal_entry SCHEMALESS;
    DEFINE TABLE IF NOT EXISTS stoa_ritual_run SCHEMALESS;
    DEFINE TABLE IF NOT EXISTS stoa_curriculum_progress SCHEMALESS;
    DEFINE INDEX IF NOT EXISTS stoa_session_identity ON stoa_session FIELDS session_id, user_id;
    DEFINE INDEX IF NOT EXISTS stoa_session_turn_identity ON stoa_session_turn FIELDS session_id, user_id, timestamp;
    DEFINE INDEX IF NOT EXISTS stoa_profile_user ON stoa_profile FIELDS user_id UNIQUE;
    DEFINE INDEX IF NOT EXISTS stoa_action_item_identity ON stoa_action_item FIELDS user_id, session_id, status, timeframe;
    DEFINE INDEX IF NOT EXISTS stoa_journal_entry_identity ON stoa_journal_entry FIELDS user_id, session_id, created_at;
    DEFINE INDEX IF NOT EXISTS stoa_curriculum_progress_user ON stoa_curriculum_progress FIELDS user_id UNIQUE;
  `);
  stoaTablesEnsured = true;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 12);
}

function extractProfileSignals(turns: ConversationTurn[]): {
  goals: string[];
  triggers: string[];
  practices: string[];
} {
  const goals: string[] = [];
  const triggers: string[] = [];
  const practices: string[] = [];
  for (const turn of turns) {
    if (turn.role !== 'user') continue;
    const low = turn.content.toLowerCase();
    if (low.includes('i want to') || low.includes('my goal')) goals.push(turn.content.slice(0, 120));
    if (low.includes('trigger') || low.includes('urge') || low.includes('when i')) {
      triggers.push(turn.content.slice(0, 120));
    }
    if (low.includes('practice') || low.includes('habit') || low.includes('daily')) {
      practices.push(turn.content.slice(0, 120));
    }
  }
  return {
    goals: uniq(goals),
    triggers: uniq(triggers),
    practices: uniq(practices)
  };
}

export async function loadStoaProfile(userId: string): Promise<StoaProfile> {
  try {
    await ensureStoaTables();
    const rows = await query<Array<{
      user_id?: string;
      goals?: string[];
      triggers?: string[];
      practices?: string[];
      updated_at?: string;
    }>>(
      `SELECT user_id, goals, triggers, practices, updated_at
       FROM stoa_profile
       WHERE user_id = $userId
       LIMIT 1`,
      { userId }
    );
    const row = rows[0];
    return {
      userId,
      goals: Array.isArray(row?.goals) ? row.goals : [],
      triggers: Array.isArray(row?.triggers) ? row.triggers : [],
      practices: Array.isArray(row?.practices) ? row.practices : [],
      stoicLevel: (row as Record<string, unknown> | undefined)?.stoic_level as StoicLevel | undefined,
      primaryChallenge: (row as Record<string, unknown> | undefined)?.primary_challenge as string | undefined,
      intakeCompletedAt: (row as Record<string, unknown> | undefined)?.intake_completed_at as
        | string
        | undefined,
      intakeVersion: ((row as Record<string, unknown> | undefined)?.intake_version as number | undefined) ?? 1,
      updatedAt: row?.updated_at ?? null
    };
  } catch {
    return { userId, goals: [], triggers: [], practices: [], updatedAt: null };
  }
}

export async function updateStoaProfileFromTurns(params: {
  userId: string;
  turns: ConversationTurn[];
}): Promise<void> {
  const extracted = extractProfileSignals(params.turns);
  if (extracted.goals.length === 0 && extracted.triggers.length === 0 && extracted.practices.length === 0) {
    return;
  }
  try {
    await ensureStoaTables();
    const existing = await loadStoaProfile(params.userId);
    const merged = {
      goals: uniq([...existing.goals, ...extracted.goals]),
      triggers: uniq([...existing.triggers, ...extracted.triggers]),
      practices: uniq([...existing.practices, ...extracted.practices])
    };
    await query(
      `UPSERT stoa_profile
       SET user_id = $userId,
           goals = $goals,
           triggers = $triggers,
           practices = $practices,
           intake_version = 1,
           updated_at = time::now()
       WHERE user_id = $userId`,
      { userId: params.userId, ...merged }
    );
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[STOA] Failed updating profile signals:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

export async function upsertStoaProfile(params: {
  userId: string;
  goals: string[];
  triggers: string[];
  practices: string[];
  stoicLevel?: StoicLevel;
  primaryChallenge?: string;
  intakeCompletedAt?: string | null;
  intakeVersion?: number;
}): Promise<StoaProfile> {
  const normalized = {
    goals: uniq(params.goals),
    triggers: uniq(params.triggers),
    practices: uniq(params.practices)
  };
  try {
    await ensureStoaTables();
    await query(
      `UPSERT stoa_profile
       SET user_id = $userId,
           goals = $goals,
           triggers = $triggers,
           practices = $practices,
           stoic_level = $stoicLevel,
           primary_challenge = $primaryChallenge,
           intake_completed_at = $intakeCompletedAt,
           intake_version = $intakeVersion,
           updated_at = time::now()
       WHERE user_id = $userId`,
      {
        userId: params.userId,
        stoicLevel: params.stoicLevel ?? null,
        primaryChallenge: params.primaryChallenge ?? null,
        intakeCompletedAt: params.intakeCompletedAt ?? null,
        intakeVersion: params.intakeVersion ?? 1,
        ...normalized
      }
    );
    return {
      userId: params.userId,
      ...normalized,
      stoicLevel: params.stoicLevel ?? null,
      primaryChallenge: params.primaryChallenge ?? null,
      intakeCompletedAt: params.intakeCompletedAt ?? null,
      intakeVersion: params.intakeVersion ?? 1
    };
  } catch {
    return {
      userId: params.userId,
      ...normalized,
      stoicLevel: params.stoicLevel ?? null,
      primaryChallenge: params.primaryChallenge ?? null,
      intakeCompletedAt: params.intakeCompletedAt ?? null,
      intakeVersion: params.intakeVersion ?? 1
    };
  }
}

export async function upsertStoaOnboarding(params: {
  userId: string;
  onboarding: StoaOnboardingProfile;
}): Promise<StoaProfile> {
  return upsertStoaProfile({
    userId: params.userId,
    goals: params.onboarding.goals,
    triggers: params.onboarding.triggers,
    practices: [],
    stoicLevel: params.onboarding.stoicLevel,
    primaryChallenge: params.onboarding.primaryChallenge,
    intakeCompletedAt: params.onboarding.completedAt ?? new Date().toISOString(),
    intakeVersion: params.onboarding.intakeVersion ?? 1
  });
}

export async function resetStoaOnboarding(userId: string): Promise<void> {
  try {
    await ensureStoaTables();
    await query(
      `UPDATE stoa_profile
       SET stoic_level = NONE,
           primary_challenge = NONE,
           intake_completed_at = NONE,
           intake_version = 1,
           updated_at = time::now()
       WHERE user_id = $userId`,
      { userId }
    );
  } catch {
    // no-op fallback
  }
}

export async function upsertActionItems(params: {
  userId: string;
  sessionId: string;
  items: Array<{
    text: string;
    timeframe: ActionLoopTimeframe;
    origin: 'auto_detected' | 'manual' | 'ritual';
    sourceTurnId?: string | null;
    confidenceScore?: number;
  }>;
}): Promise<void> {
  if (params.items.length === 0) return;
  await ensureStoaTables();
  for (const item of params.items) {
    const text = item.text.trim();
    if (!text) continue;
    await query(
      `CREATE stoa_action_item CONTENT {
        user_id: $userId,
        session_id: $sessionId,
        source_turn_id: $sourceTurnId,
        text: $text,
        timeframe: $timeframe,
        status: 'pending',
        origin: $origin,
        confidence_score: $confidenceScore,
        created_at: time::now(),
        updated_at: time::now()
      }`,
      {
        userId: params.userId,
        sessionId: params.sessionId,
        sourceTurnId: item.sourceTurnId ?? null,
        text,
        timeframe: item.timeframe,
        origin: item.origin,
        confidenceScore: item.confidenceScore ?? 0.5
      }
    );
  }
}

export async function listIncompleteActionItems(params: {
  userId: string;
  lookbackDays?: number;
}): Promise<StoaActionItem[]> {
  await ensureStoaTables();
  const rows = await query<
    Array<{
      id: string;
      user_id: string;
      session_id: string;
      source_turn_id?: string;
      text: string;
      timeframe: ActionLoopTimeframe;
      status: ActionItemStatus;
      origin: 'auto_detected' | 'manual' | 'ritual';
      confidence_score?: number;
      created_at?: string;
      updated_at?: string;
      completed_at?: string;
    }>
  >(
    `SELECT *
     FROM stoa_action_item
     WHERE user_id = $userId AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 20`,
    { userId: params.userId, lookbackDays: params.lookbackDays ?? 14 }
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    sourceTurnId: row.source_turn_id ?? null,
    text: row.text,
    timeframe: row.timeframe,
    status: row.status,
    origin: row.origin,
    confidenceScore: row.confidence_score ?? 0.5,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    completedAt: row.completed_at ?? null
  }));
}

export async function updateActionItemStatus(params: {
  userId: string;
  itemId: string;
  status: ActionItemStatus;
}): Promise<void> {
  await ensureStoaTables();
  await query(
    `UPDATE stoa_action_item
     SET status = $status,
         updated_at = time::now(),
         completed_at = IF $status = 'done' THEN time::now() ELSE completed_at END
     WHERE id = $itemId AND user_id = $userId`,
    { userId: params.userId, itemId: params.itemId, status: params.status }
  );
}

export async function createJournalEntry(params: {
  userId: string;
  sessionId: string;
  entryText: string;
  themes?: string[];
}): Promise<void> {
  const text = params.entryText.trim();
  if (!text) return;
  await ensureStoaTables();
  await query(
    `CREATE stoa_journal_entry CONTENT {
      user_id: $userId,
      session_id: $sessionId,
      entry_text: $entryText,
      themes: $themes,
      created_at: time::now()
    }`,
    {
      userId: params.userId,
      sessionId: params.sessionId,
      entryText: text.slice(0, 500),
      themes: uniq(params.themes ?? [])
    }
  );
}

export async function listJournalEntries(params: {
  userId: string;
  limit?: number;
}): Promise<JournalEntry[]> {
  await ensureStoaTables();
  const rows = await query<
    Array<{ id: string; user_id: string; session_id: string; entry_text: string; themes?: string[]; created_at?: string }>
  >(
    `SELECT *
     FROM stoa_journal_entry
     WHERE user_id = $userId
     ORDER BY created_at DESC
     LIMIT $limit`,
    { userId: params.userId, limit: Math.max(1, Math.min(params.limit ?? 30, 100)) }
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    entryText: row.entry_text,
    themes: Array.isArray(row.themes) ? row.themes : [],
    createdAt: row.created_at ?? null
  }));
}

export async function listRelevantJournalEntries(params: {
  userId: string;
  message: string;
  limit?: number;
}): Promise<JournalEntry[]> {
  const all = await listJournalEntries({ userId: params.userId, limit: 80 });
  const tokens = new Set(
    params.message
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 4)
  );
  if (tokens.size === 0) return all.slice(0, params.limit ?? 3);
  const scored = all
    .map((entry) => {
      const low = entry.entryText.toLowerCase();
      let score = 0;
      for (const token of tokens) if (low.includes(token)) score += 1;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, params.limit ?? 3).map((item) => item.entry);
}

const STOA_CURRICULUM_WEEKS: CurriculumWeek[] = [
  {
    weekNumber: 1,
    conceptKey: 'dichotomy_of_control',
    conceptTitle: 'Dichotomy of Control',
    practicePrompt: 'List one thing within your control and one outside it before your hardest task today.',
    reflectionQuestion: 'Where did you waste energy on what was not up to you?'
  },
  {
    weekNumber: 2,
    conceptKey: 'judgements_and_assent',
    conceptTitle: 'Judgements and Assent',
    practicePrompt: 'Pause once today and label an impression before acting on it.',
    reflectionQuestion: 'Which judgment shaped your mood most strongly today?'
  },
  {
    weekNumber: 3,
    conceptKey: 'preferred_indifferents',
    conceptTitle: 'Preferred Indifferents',
    practicePrompt: 'Pursue one preferred outcome while mentally releasing entitlement to it.',
    reflectionQuestion: 'What did you prefer today without treating it as the good itself?'
  },
  {
    weekNumber: 4,
    conceptKey: 'virtue_sole_good',
    conceptTitle: 'Virtue as the Sole Good',
    practicePrompt: 'Choose one moment to prioritize character over convenience.',
    reflectionQuestion: 'Where did you choose courage, justice, temperance, or wisdom?'
  },
  {
    weekNumber: 5,
    conceptKey: 'cosmopolitanism_oikeiosis',
    conceptTitle: 'Cosmopolitanism and Oikeiosis',
    practicePrompt: 'Act once today for the common good without immediate personal reward.',
    reflectionQuestion: 'How did you widen concern beyond yourself today?'
  },
  {
    weekNumber: 6,
    conceptKey: 'integration_review',
    conceptTitle: 'Integration and Review',
    practicePrompt: 'Combine one control split with one evening review tonight.',
    reflectionQuestion: 'What Stoic move is becoming your default under pressure?'
  }
];

export function listCurriculumWeeks(): CurriculumWeek[] {
  return STOA_CURRICULUM_WEEKS;
}

export async function loadCurriculumProgress(userId: string): Promise<CurriculumProgress> {
  await ensureStoaTables();
  const rows = await query<
    Array<{
      user_id: string;
      current_week?: number;
      week_started_at?: string;
      started_at?: string;
      pace_mode?: 'calendar_week' | 'rolling_7_day';
      completed_weeks?: number[];
    }>
  >(
    `SELECT *
     FROM stoa_curriculum_progress
     WHERE user_id = $userId
     LIMIT 1`,
    { userId }
  );
  const row = rows[0];
  if (!row) {
    return {
      userId,
      currentWeek: 1,
      paceMode: 'rolling_7_day',
      completedWeeks: [],
      startedAt: null,
      weekStartedAt: null
    };
  }
  return {
    userId,
    currentWeek: typeof row.current_week === 'number' ? row.current_week : 1,
    paceMode: row.pace_mode ?? 'rolling_7_day',
    completedWeeks: Array.isArray(row.completed_weeks) ? row.completed_weeks : [],
    startedAt: row.started_at ?? null,
    weekStartedAt: row.week_started_at ?? null
  };
}

export async function upsertCurriculumProgress(params: {
  userId: string;
  currentWeek: number;
  completedWeeks: number[];
  paceMode?: 'calendar_week' | 'rolling_7_day';
}): Promise<CurriculumProgress> {
  await ensureStoaTables();
  await query(
    `UPSERT stoa_curriculum_progress
     SET user_id = $userId,
         current_week = $currentWeek,
         completed_weeks = $completedWeeks,
         pace_mode = $paceMode,
         started_at = IF started_at = NONE THEN time::now() ELSE started_at END,
         week_started_at = time::now()
     WHERE user_id = $userId`,
    {
      userId: params.userId,
      currentWeek: Math.max(1, Math.min(params.currentWeek, 6)),
      completedWeeks: Array.from(new Set(params.completedWeeks)).sort(),
      paceMode: params.paceMode ?? 'rolling_7_day'
    }
  );
  return loadCurriculumProgress(params.userId);
}

export async function logRitualRun(params: {
  userId: string;
  sessionId?: string | null;
  ritualType: 'morning' | 'evening';
  answers: Record<string, string>;
  durationSeconds: number;
}): Promise<void> {
  await ensureStoaTables();
  await query(
    `CREATE stoa_ritual_run CONTENT {
      user_id: $userId,
      session_id: $sessionId,
      ritual_type: $ritualType,
      answers: $answers,
      duration_seconds: $durationSeconds,
      created_at: time::now()
    }`,
    {
      userId: params.userId,
      sessionId: params.sessionId ?? null,
      ritualType: params.ritualType,
      answers: params.answers,
      durationSeconds: Math.max(0, Math.floor(params.durationSeconds))
    }
  );
}

async function ensureSessionRecord(sessionId: string, userId: string): Promise<void> {
  const rows = await query<SessionRow[]>(
    `SELECT * FROM stoa_session WHERE session_id = $sessionId AND user_id = $userId LIMIT 1`,
    { sessionId, userId }
  );
  if (rows.length > 0) return;
  await query(
    `CREATE stoa_session CONTENT {
      session_id: $sessionId,
      user_id: $userId,
      summary: '',
      updated_at: time::now()
    }`,
    { sessionId, userId }
  );
}

function mapTurn(row: TurnRow): ConversationTurn {
  return {
    role: row.role === 'agent' ? 'agent' : 'user',
    content: typeof row.content === 'string' ? row.content : '',
    timestamp: typeof row.timestamp === 'string' ? row.timestamp : new Date().toISOString(),
    stance:
      row.stance === 'hold' ||
      row.stance === 'challenge' ||
      row.stance === 'guide' ||
      row.stance === 'teach' ||
      row.stance === 'sit_with'
        ? row.stance
        : undefined,
    frameworksReferenced: Array.isArray(row.frameworks_referenced)
      ? row.frameworks_referenced
      : undefined
  };
}

export async function loadStoaSession(params: {
  sessionId: string;
  userId: string;
}): Promise<SessionState> {
  const { sessionId, userId } = params;
  try {
    const sessionRows = await query<SessionRow[]>(
      `SELECT * FROM stoa_session WHERE session_id = $sessionId AND user_id = $userId LIMIT 1`,
      { sessionId, userId }
    );
    const session = sessionRows[0];
    const turnRows = await query<TurnRow[]>(
      `SELECT role, content, timestamp, stance, frameworks_referenced
       FROM stoa_session_turn
       WHERE session_id = $sessionId AND user_id = $userId
       ORDER BY timestamp ASC`,
      { sessionId, userId }
    );
    return {
      sessionId,
      userId,
      summary: session?.summary ?? null,
      turns: turnRows.map(mapTurn),
      updatedAt: session?.updated_at ?? null
    };
  } catch (error) {
    if (isMissingTableError(error)) {
      try {
        await ensureStoaTables();
        return { sessionId, userId, summary: null, turns: [], updatedAt: null };
      } catch {
        // Fall through to degraded empty-session return below.
      }
    }
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[STOA] Failed to load session; using empty session fallback:',
        error instanceof Error ? error.message : String(error)
      );
    }
    return { sessionId, userId, summary: null, turns: [], updatedAt: null };
  }
}

export async function appendStoaTurns(params: {
  sessionId: string;
  userId: string;
  turns: ConversationTurn[];
  summary?: string | null;
}): Promise<void> {
  const { sessionId, userId, turns, summary } = params;
  if (turns.length === 0) return;
  try {
    await ensureStoaTables();
    await ensureSessionRecord(sessionId, userId);
  } catch (error) {
    // Session persistence is best-effort; avoid failing the full dialogue response path.
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[STOA] Session table ensure failed; skipping persistence:',
        error instanceof Error ? error.message : String(error)
      );
    }
    return;
  }

  for (const turn of turns) {
    try {
      await query(
        `CREATE stoa_session_turn CONTENT {
          session_id: $sessionId,
          user_id: $userId,
          role: $role,
          content: $content,
          timestamp: $timestamp,
          stance: $stance,
          frameworks_referenced: $frameworksReferenced
        }`,
        {
          sessionId,
          userId,
          role: turn.role,
          content: turn.content,
          timestamp: turn.timestamp,
          stance: turn.stance ?? null,
          frameworksReferenced: turn.frameworksReferenced ?? []
        }
      );
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          '[STOA] Failed writing session turn; continuing without persistence:',
          error instanceof Error ? error.message : String(error)
        );
      }
      return;
    }
  }

  try {
    await query(
      `UPDATE stoa_session
       SET updated_at = time::now(), summary = $summary
       WHERE session_id = $sessionId AND user_id = $userId`,
      {
        sessionId,
        userId,
        summary: summary ?? ''
      }
    );
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[STOA] Failed updating session summary; continuing without persistence:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

