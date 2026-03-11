import { describe, expect, it } from 'vitest';
import { LessonUnitSchema, type LessonUnit } from '$lib/types/learn';
import { validateLessonPedagogy } from '$lib/server/learn/pedagogy';

function buildLesson(overrides: Partial<LessonUnit> = {}): LessonUnit {
  return LessonUnitSchema.parse({
    id: 'ethics_intro_test',
    title: 'Test Lesson',
    category: 'Ethics',
    section: 'daily',
    domain: 'ethics',
    difficulty: 1,
    duration: '5-7 mins',
    objectives: ['Differentiate descriptive and normative claims.', 'Identify hidden assumptions.'],
    lesson_content_markdown: `## Core idea
A moral argument uses both descriptive claims and normative commitments.
We test each premise and make assumptions explicit before drawing conclusions.

## Why it matters
Learners often confuse what is common with what is justified.
This section helps them separate factual reporting from moral evaluation.

## Worked example
Premise one states a descriptive observation.
Premise two provides a normative bridge principle.
The conclusion follows only when both are explicit and connected.

## Before writing
Draft a three-part argument with clear labels, then pressure test the bridge premise.`,
    examples: [
      {
        statement: 'Lying is wrong because it harms trust.',
        task: 'Separate descriptive and normative components.',
        citation: 'Kant, 1785'
      }
    ],
    quiz: [
      {
        question: 'What kind of claim says what ought to be done?',
        options: ['Descriptive', 'Normative'],
        answer: 'Normative'
      }
    ],
    followup_exercise: {
      question: 'Write 100 words on is/ought.',
      expected_length: '80-120',
      ai_feedback_mode: 'short_answer_review'
    },
    references: [
      {
        title: 'Groundwork of the Metaphysics of Morals',
        citation: 'Kant, 1785'
      },
      {
        title: 'A Treatise of Human Nature',
        citation: 'Hume, 1739'
      }
    ],
    ...overrides
  });
}

describe('validateLessonPedagogy', () => {
  it('accepts a valid lesson', () => {
    const lesson = buildLesson();
    expect(validateLessonPedagogy(lesson)).toEqual([]);
  });

  it('requires at least two references', () => {
    const lesson = buildLesson({
      references: [{ title: 'Only one', citation: 'Test, 2026' }]
    });
    const issues = validateLessonPedagogy(lesson);
    expect(issues.some((issue) => issue.code === 'insufficient_references')).toBe(true);
  });

  it('requires source attribution on examples', () => {
    const lesson = buildLesson({
      examples: [{ statement: 'Example', task: 'Analyse this.' }]
    });
    const issues = validateLessonPedagogy(lesson);
    expect(issues.some((issue) => issue.code === 'example_missing_attribution')).toBe(true);
  });

  it('requires guided reading for difficulty 3+', () => {
    const lesson = buildLesson({
      section: 'practice',
      difficulty: 3,
      quiz: [],
      followup_exercise: {
        question: 'Write 250 words with objection and reply.',
        expected_length: '220-280',
        ai_feedback_mode: 'essay_review'
      }
    });
    const issues = validateLessonPedagogy(lesson);
    expect(issues.some((issue) => issue.code === 'guided_reading_required')).toBe(true);
  });
});
