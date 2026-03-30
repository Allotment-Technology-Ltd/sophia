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
    if (!isDatabaseUnavailable(error)) throw error;
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
  await ensureSessionRecord(sessionId, userId);

  for (const turn of turns) {
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
  }

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
}

