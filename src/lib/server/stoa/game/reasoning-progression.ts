import { query } from '$lib/server/db';

export interface ReasoningTrend {
  userId: string;
  lastN: number;
  scores: number[];
  movingAverage: number;
  consecutiveUpwardSessions: number;
  isImproving: boolean;
  direction: 'improved' | 'steady' | 'inconsistent';
}

interface ReasoningAssessmentRow {
  quality_score?: number;
  assessed_at?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function computeConsecutiveUpwardSessions(scores: number[]): number {
  if (scores.length === 0) return 0;
  let sessions = 1;
  for (let i = scores.length - 1; i > 0; i -= 1) {
    if (scores[i] > scores[i - 1]) {
      sessions += 1;
      continue;
    }
    break;
  }
  return sessions;
}

function computeTrendDirection(scores: number[], isImproving: boolean): ReasoningTrend['direction'] {
  if (isImproving) return 'improved';
  if (scores.length < 2) return 'steady';

  const first = scores[0] ?? 0;
  const last = scores[scores.length - 1] ?? 0;
  if (Math.abs(last - first) <= 0.03) {
    return 'steady';
  }

  let increases = 0;
  let decreases = 0;
  for (let i = 1; i < scores.length; i += 1) {
    const delta = scores[i] - scores[i - 1];
    if (delta > 0.015) increases += 1;
    if (delta < -0.015) decreases += 1;
  }

  if (increases === 0 || decreases === 0) {
    return 'steady';
  }
  return 'inconsistent';
}

export async function getReasoningTrend(userId: string, lastN = 10): Promise<ReasoningTrend> {
  const normalizedLastN = Math.max(1, Math.floor(lastN));
  const rows = await query<ReasoningAssessmentRow[]>(
    `SELECT quality_score, assessed_at
     FROM stoa_reasoning_assessment
     WHERE user_id = <record<user>>$userRecord
     ORDER BY assessed_at DESC
     LIMIT $limit`,
    {
      userRecord: `user:${userId}`,
      limit: normalizedLastN
    }
  );

  const chronological = [...rows]
    .sort((a, b) => Date.parse(a.assessed_at ?? '') - Date.parse(b.assessed_at ?? ''))
    .map((row) => clamp01(Number(row.quality_score ?? 0)));

  const movingAverage =
    chronological.length === 0
      ? 0
      : chronological.reduce((sum, value) => sum + value, 0) / chronological.length;

  const consecutiveUpwardSessions = computeConsecutiveUpwardSessions(chronological);
  const isImproving = consecutiveUpwardSessions >= 3;
  return {
    userId,
    lastN: normalizedLastN,
    scores: chronological,
    movingAverage,
    consecutiveUpwardSessions,
    isImproving,
    direction: computeTrendDirection(chronological, isImproving)
  };
}
