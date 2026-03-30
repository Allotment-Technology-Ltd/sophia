import { isDatabaseUnavailable, query } from '$lib/server/db';
import type { ConversationTurn, SessionState } from './types';

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
    DEFINE INDEX IF NOT EXISTS stoa_session_identity ON stoa_session FIELDS session_id, user_id;
    DEFINE INDEX IF NOT EXISTS stoa_session_turn_identity ON stoa_session_turn FIELDS session_id, user_id, timestamp;
    DEFINE INDEX IF NOT EXISTS stoa_profile_user ON stoa_profile FIELDS user_id UNIQUE;
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

