import type { LessonUnit } from '$lib/types/learn';

export interface LessonPedagogyIssue {
  code: string;
  message: string;
}

function hasSourceAttribution(example: LessonUnit['examples'][number]): boolean {
  return Boolean(example.citation || example.source_url);
}

export function validateLessonPedagogy(lesson: LessonUnit): LessonPedagogyIssue[] {
  const issues: LessonPedagogyIssue[] = [];
  const minimumPrimerLength = lesson.section === 'daily' ? 500 : 80;

  if (lesson.objectives.length < 2 || lesson.objectives.length > 4) {
    issues.push({
      code: 'objectives_range',
      message: 'Lessons must define between 2 and 4 objectives.'
    });
  }

  if (lesson.lesson_content_markdown.trim().length < minimumPrimerLength) {
    issues.push({
      code: 'content_too_short',
      message: `Lesson content is too short to act as a meaningful primer (min ${minimumPrimerLength} chars).`
    });
  }

  if (lesson.examples.length < 1) {
    issues.push({
      code: 'missing_examples',
      message: 'Lessons must include at least one philosophical example.'
    });
  } else {
    const unattributedExample = lesson.examples.find((example) => !hasSourceAttribution(example));
    if (unattributedExample) {
      issues.push({
        code: 'example_missing_attribution',
        message: 'Each lesson example must include a citation or source URL.'
      });
    }
  }

  if (lesson.references.length < 2) {
    issues.push({
      code: 'insufficient_references',
      message: 'Lessons must include at least two references.'
    });
  }

  if (lesson.section === 'daily' && lesson.quiz.length < 1) {
    issues.push({
      code: 'daily_missing_quiz',
      message: 'Daily drills must include at least one retrieval quiz item.'
    });
  }

  if (lesson.difficulty >= 3 && !lesson.guided_reading) {
    issues.push({
      code: 'guided_reading_required',
      message: 'Difficulty 3+ lessons must include a guided reading task.'
    });
  }

  return issues;
}
