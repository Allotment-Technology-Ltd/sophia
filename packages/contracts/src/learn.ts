import { z } from 'zod';

export const LearnSectionSchema = z.enum(['daily', 'practice', 'submit', 'progress']);
export type LearnSection = z.infer<typeof LearnSectionSchema>;

export const LearnDomainSchema = z.enum(['ethics', 'politics', 'epistemology', 'metaphysics', 'logic']);
export type LearnDomain = z.infer<typeof LearnDomainSchema>;

export const LessonQuizItemSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  answer: z.string().min(1)
});

export const LessonExampleSchema = z.object({
  statement: z.string().min(1),
  task: z.string().min(1),
  thinker: z.string().min(1).optional(),
  work: z.string().min(1).optional(),
  citation: z.string().min(1).optional(),
  source_url: z.string().url().optional()
});

export const FollowupExerciseSchema = z.object({
  question: z.string().min(1),
  expected_length: z.string().min(1),
  ai_feedback_mode: z.enum(['short_answer_review', 'essay_review'])
});

export const LessonReferenceSchema = z.object({
  title: z.string().min(1),
  citation: z.string().min(1),
  note: z.string().min(1).optional(),
  url: z.string().url().optional()
});

export const GuidedReadingChunkSchema = z.object({
  id: z.string().min(1),
  heading: z.string().min(1),
  excerpt: z.string().min(1),
  why_it_matters: z.string().min(1),
  discussion_prompt: z.string().min(1),
  estimated_minutes: z.number().int().min(1).max(30)
});

export const GuidedReadingTaskSchema = z.object({
  source_title: z.string().min(1),
  author: z.string().min(1),
  citation: z.string().min(1),
  source_url: z.string().url().optional(),
  chunks: z.array(GuidedReadingChunkSchema).min(1)
});

export const LessonUnitSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  section: z.enum(['daily', 'practice']),
  domain: LearnDomainSchema,
  difficulty: z.number().int().min(1).max(5),
  duration: z.string().min(1),
  objectives: z.array(z.string().min(1)).min(1),
  lesson_content_markdown: z.string().min(1),
  examples: z.array(LessonExampleSchema).default([]),
  quiz: z.array(LessonQuizItemSchema).default([]),
  followup_exercise: FollowupExerciseSchema.optional(),
  next_lesson_id: z.string().nullable().optional(),
  prerequisite_lesson_id: z.string().nullable().optional(),
  references: z.array(LessonReferenceSchema).default([]),
  guided_reading: GuidedReadingTaskSchema.optional()
});

export type LessonUnit = z.infer<typeof LessonUnitSchema>;

export const SkillScoresSchema = z.object({
  clarity: z.number().min(0).max(100),
  coherence: z.number().min(0).max(100),
  critique_depth: z.number().min(0).max(100),
  originality: z.number().min(0).max(100)
});
export type SkillScores = z.infer<typeof SkillScoresSchema>;

export const EssayPassFeedbackSchema = z.object({
  analysis: z.string().min(1),
  critique: z.string().min(1),
  synthesis: z.string().min(1)
});

export const EssayFeedbackSchema = z.object({
  domain: LearnDomainSchema,
  analysis_summary: z.string().min(1),
  critique_points: z.array(z.string().min(1)).min(1),
  synthesis_suggestions: z.string().min(1),
  referenced_thinkers: z.array(z.string().min(1)).default([]),
  score_rationale: z.string().min(1),
  recommended_lessons: z.array(z.string().min(1)).default([]),
  summary_score: z.number().min(0).max(100),
  dimension_scores: SkillScoresSchema,
  pass_feedback: EssayPassFeedbackSchema
});

export type EssayFeedback = z.infer<typeof EssayFeedbackSchema>;

export const ShortAnswerMiniReviewSchema = z.object({
  analysis: z.string().min(1),
  critique: z.string().min(1),
  synthesis: z.string().min(1),
  micro_score: z.number().min(0).max(10),
  encouragement: z.string().min(1)
});

export type ShortAnswerMiniReview = z.infer<typeof ShortAnswerMiniReviewSchema>;

export const EssaySubmissionSchema = z.object({
  id: z.string(),
  user_id: z.string().min(1),
  type: z.enum(['essay', 'short_answer']),
  question: z.string().min(1),
  text: z.string().min(1),
  word_count: z.number().int().min(1),
  latest_version: z.number().int().min(1),
  summary_score: z.number().min(0).max(100).optional(),
  dimension_scores: SkillScoresSchema.optional(),
  created_at: z.string(),
  updated_at: z.string(),
  lesson_id: z.string().optional()
});
export type EssaySubmission = z.infer<typeof EssaySubmissionSchema>;

export const EssayVersionSchema = z.object({
  id: z.string(),
  submission_id: z.string().min(1),
  version_number: z.number().int().min(1),
  question: z.string().min(1),
  text: z.string().min(1),
  word_count: z.number().int().min(1),
  feedback: EssayFeedbackSchema.optional(),
  short_review: ShortAnswerMiniReviewSchema.optional(),
  created_at: z.string()
});
export type EssayVersion = z.infer<typeof EssayVersionSchema>;

export const UserProgressSchema = z.object({
  user_id: z.string().min(1),
  completed_units: z.array(z.string()),
  essay_history: z.array(z.string()),
  skill_scores: SkillScoresSchema,
  recommendation: z.string().min(1),
  trajectory_delta: z.number(),
  updated_at: z.string()
});

export type UserProgress = z.infer<typeof UserProgressSchema>;

export interface LearnEntitlementSummary {
  tier: 'free' | 'pro' | 'premium';
  monthKey: string;
  microLessonsUsed: number;
  shortReviewsUsed: number;
  essayReviewsUsed: number;
  microLessonsRemaining: number | null;
  shortReviewsRemaining: number | null;
  essayReviewsRemaining: number | null;
  scholarCreditsBalance: number;
  scholarCreditsSpent: number;
}

export const EssayReviewRequestSchema = z.object({
  question: z.string().min(3),
  text: z.string().min(100),
  lesson_id: z.string().optional(),
  model_provider: z.string().optional(),
  model_id: z.string().optional(),
  depth: z.enum(['quick', 'standard', 'deep']).optional()
});

export const EssayReviseRequestSchema = z.object({
  revised_text: z.string().min(100),
  question: z.string().min(3).optional(),
  depth: z.enum(['quick', 'standard', 'deep']).optional(),
  model_provider: z.string().optional(),
  model_id: z.string().optional()
});

export const ShortReviewRequestSchema = z.object({
  question: z.string().min(3),
  response_text: z.string().min(40).max(2000),
  lesson_id: z.string().optional(),
  model_provider: z.string().optional(),
  model_id: z.string().optional(),
  depth: z.enum(['quick', 'standard', 'deep']).optional()
});

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
