import { query } from '$lib/server/db';
import type { ArrivalReason, StartingPath, StanceType, StoaProfile } from '$lib/types/stoa';

type StoaProfileRow = {
  user_id?: string;
  arrival_reason?: ArrivalReason;
  starting_path?: StartingPath;
  beat3_choice?: string;
  opening_struggle?: string | null;
  opening_struggle_embedding?: number[] | null;
  philosophy_level?: StoaProfile['philosophyLevel'];
  thinking_style?: StoaProfile['thinkingStyle'];
  emotional_presence?: StoaProfile['emotionalPresence'];
  primary_struggle_type?: StoaProfile['primaryStruggleType'];
  suggested_opening_stance?: StanceType | null;
  first_session_id?: string;
  created_at?: string;
  last_seen_at?: string;
  total_sessions?: number;
};

function toUserRecord(userId: string): string {
  return `user:${userId}`;
}

function mapRowToProfile(userId: string, row: StoaProfileRow): StoaProfile {
  const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();
  const lastSeenAt = typeof row.last_seen_at === 'string' ? row.last_seen_at : createdAt;
  return {
    userId,
    arrivalReason: row.arrival_reason ?? 'uncertain',
    startingPath: row.starting_path ?? 'colonnade',
    beat3Choice: row.beat3_choice ?? '',
    openingStruggle: typeof row.opening_struggle === 'string' ? row.opening_struggle : null,
    openingStruggleEmbedding: Array.isArray(row.opening_struggle_embedding)
      ? row.opening_struggle_embedding
      : null,
    philosophyLevel: row.philosophy_level ?? null,
    thinkingStyle: row.thinking_style ?? null,
    emotionalPresence: row.emotional_presence ?? null,
    primaryStruggleType: row.primary_struggle_type ?? null,
    suggestedOpeningStance: row.suggested_opening_stance ?? null,
    firstSessionId: row.first_session_id ?? '',
    createdAt,
    lastSeenAt,
    totalSessions: typeof row.total_sessions === 'number' ? row.total_sessions : 0
  };
}

export async function getStoaProfile(userId: string): Promise<StoaProfile | null> {
  const rows = await query<StoaProfileRow[]>(
    `SELECT *
     FROM stoa_profile
     WHERE user_id = <record<user>>$userRecord
     LIMIT 1`,
    { userRecord: toUserRecord(userId) }
  );
  const row = rows[0];
  if (!row) return null;
  return mapRowToProfile(userId, row);
}

export async function createStoaProfile(
  userId: string,
  data: {
    arrivalReason: ArrivalReason;
    startingPath: StartingPath;
    openingStruggle: string | null;
    firstSessionId: string;
    openingStruggleEmbedding?: number[] | null;
  }
): Promise<StoaProfile> {
  await query(
    `UPSERT stoa_profile
     SET user_id = <record<user>>$userRecord,
         arrival_reason = $arrivalReason,
         starting_path = $startingPath,
         beat3_choice = '',
         opening_struggle = $openingStruggle,
         opening_struggle_embedding = $openingStruggleEmbedding,
         philosophy_level = NONE,
         thinking_style = NONE,
         emotional_presence = NONE,
         primary_struggle_type = NONE,
         suggested_opening_stance = NONE,
         first_session_id = $firstSessionId,
         created_at = time::now(),
         last_seen_at = time::now(),
         total_sessions = 1
     WHERE user_id = <record<user>>$userRecord`,
    {
      userRecord: toUserRecord(userId),
      arrivalReason: data.arrivalReason,
      startingPath: data.startingPath,
      openingStruggle: data.openingStruggle,
      openingStruggleEmbedding: data.openingStruggleEmbedding ?? null,
      firstSessionId: data.firstSessionId
    }
  );

  const profile = await getStoaProfile(userId);
  if (!profile) {
    throw new Error('Profile creation succeeded but profile was not returned');
  }
  return profile;
}

export async function updateStoaProfile(
  userId: string,
  updates: Partial<StoaProfile>
): Promise<StoaProfile> {
  const payload: Record<string, unknown> = {};

  if (updates.arrivalReason !== undefined) payload.arrival_reason = updates.arrivalReason;
  if (updates.startingPath !== undefined) payload.starting_path = updates.startingPath;
  if (updates.beat3Choice !== undefined) payload.beat3_choice = updates.beat3Choice;
  if (updates.openingStruggle !== undefined) payload.opening_struggle = updates.openingStruggle;
  if (updates.openingStruggleEmbedding !== undefined) {
    payload.opening_struggle_embedding = updates.openingStruggleEmbedding;
  }
  if (updates.philosophyLevel !== undefined) payload.philosophy_level = updates.philosophyLevel;
  if (updates.thinkingStyle !== undefined) payload.thinking_style = updates.thinkingStyle;
  if (updates.emotionalPresence !== undefined) payload.emotional_presence = updates.emotionalPresence;
  if (updates.primaryStruggleType !== undefined) {
    payload.primary_struggle_type = updates.primaryStruggleType;
  }
  if (updates.suggestedOpeningStance !== undefined) {
    payload.suggested_opening_stance = updates.suggestedOpeningStance;
  }
  if (updates.firstSessionId !== undefined) payload.first_session_id = updates.firstSessionId;
  if (updates.lastSeenAt !== undefined) payload.last_seen_at = updates.lastSeenAt;
  if (updates.totalSessions !== undefined) payload.total_sessions = updates.totalSessions;

  payload.last_seen_at = payload.last_seen_at ?? new Date().toISOString();

  if (Object.keys(payload).length > 0) {
    await query(
      `UPDATE stoa_profile
       MERGE $updates
       WHERE user_id = <record<user>>$userRecord`,
      { userRecord: toUserRecord(userId), updates: payload }
    );
  }

  const profile = await getStoaProfile(userId);
  if (!profile) {
    throw new Error('Profile update completed but profile was not found');
  }
  return profile;
}

export async function incrementStoaSessions(userId: string): Promise<void> {
  await query(
    `UPDATE stoa_profile
     SET total_sessions = math::max(1, total_sessions + 1),
         last_seen_at = time::now()
     WHERE user_id = <record<user>>$userRecord`,
    { userRecord: toUserRecord(userId) }
  );
}

export async function hasStoaProfileComplete(userId: string): Promise<boolean> {
  const profile = await getStoaProfile(userId);
  return Boolean(profile?.philosophyLevel);
}

export async function daysSinceLastSession(userId: string): Promise<number> {
  const profile = await getStoaProfile(userId);
  if (!profile?.lastSeenAt) return 0;
  const ts = Date.parse(profile.lastSeenAt);
  if (!Number.isFinite(ts)) return 0;
  const diff = Date.now() - ts;
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
