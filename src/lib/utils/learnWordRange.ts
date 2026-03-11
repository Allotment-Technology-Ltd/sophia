import type { LessonUnit } from '$lib/types/learn';

export interface LearnWordRange {
  min: number;
  max: number;
}

export const SHORT_REVIEW_ABSOLUTE_MIN_WORDS = 20;
export const SHORT_REVIEW_ABSOLUTE_MAX_WORDS = 400;

const DAILY_DEFAULT_RANGES: Record<number, LearnWordRange> = {
  1: { min: 80, max: 120 },
  2: { min: 90, max: 130 },
  3: { min: 100, max: 150 },
  4: { min: 120, max: 180 },
  5: { min: 140, max: 220 }
};

const PRACTICE_DEFAULT_RANGES: Record<number, LearnWordRange> = {
  1: { min: 120, max: 180 },
  2: { min: 160, max: 220 },
  3: { min: 220, max: 300 },
  4: { min: 260, max: 340 },
  5: { min: 300, max: 400 }
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeWordRange(min: number, max: number): LearnWordRange {
  const safeMin = clamp(Math.round(min), SHORT_REVIEW_ABSOLUTE_MIN_WORDS, SHORT_REVIEW_ABSOLUTE_MAX_WORDS);
  const safeMax = clamp(Math.round(max), SHORT_REVIEW_ABSOLUTE_MIN_WORDS, SHORT_REVIEW_ABSOLUTE_MAX_WORDS);
  if (safeMax < safeMin) {
    return { min: safeMin, max: safeMin };
  }
  return { min: safeMin, max: safeMax };
}

export function parseExpectedLengthRange(expectedLength?: string | null): LearnWordRange | null {
  if (!expectedLength) return null;
  const match = expectedLength.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return normalizeWordRange(min, max);
}

function rangeByDifficulty(
  ranges: Record<number, LearnWordRange>,
  difficulty: number
): LearnWordRange {
  const normalizedDifficulty = clamp(Math.round(difficulty), 1, 5);
  return ranges[normalizedDifficulty] ?? ranges[1];
}

export function defaultShortReviewWordRange(
  section: 'daily' | 'practice',
  difficulty: number
): LearnWordRange {
  return section === 'practice'
    ? rangeByDifficulty(PRACTICE_DEFAULT_RANGES, difficulty)
    : rangeByDifficulty(DAILY_DEFAULT_RANGES, difficulty);
}

type LessonWordRangeInput = Pick<LessonUnit, 'section' | 'difficulty' | 'followup_exercise'> | null | undefined;

export function resolveShortReviewWordRange(lesson: LessonWordRangeInput): LearnWordRange {
  const fromExpectedLength = parseExpectedLengthRange(lesson?.followup_exercise?.expected_length);
  if (fromExpectedLength) return fromExpectedLength;

  const section = lesson?.section === 'practice' ? 'practice' : 'daily';
  const difficulty = Number(lesson?.difficulty ?? 1);
  return defaultShortReviewWordRange(section, difficulty);
}

export function formatWordRange(range: LearnWordRange): string {
  return `${range.min}-${range.max}`;
}
