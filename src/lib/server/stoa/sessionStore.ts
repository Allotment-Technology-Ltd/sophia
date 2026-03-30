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
    DEFINE INDEX IF NOT EXISTS stoa_session_identity ON stoa_session FIELDS session_id, user_id;
    DEFINE INDEX IF NOT EXISTS stoa_session_turn_identity ON stoa_session_turn FIELDS session_id, user_id, timestamp;
  `);
  stoaTablesEnsured = true;
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

